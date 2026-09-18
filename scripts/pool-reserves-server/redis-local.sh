#!/usr/bin/env bash
# Loads a filtered slice of a production RDB dump into a fresh local Redis.
#
#   scripts/pool-reserves-server/redis-local.sh <dump.rdb> [chains=1,8453] [port=6399]
#
# Steps: survey key names → filter to the given chains → start redis-server
# on <port> with persistence off → pipe the filtered RESP stream in.
# Requires redis-rdb-cli (https://github.com/leonchen83/redis-rdb-cli),
# tested with v0.9.x on an RDB v10 (Redis 7.1) dump; RCT points at its `rct`.
set -euo pipefail

DUMP=${1:?path to dump.rdb}
CHAINS=${2:-1,8453}
PORT=${3:-6399}
RCT=${RCT:-$HOME/work/paraswap/rdb-tools/redis-rdb-cli/bin/rct}
WORK=${WORK:-$(dirname "$DUMP")/redis-local}
mkdir -p "$WORK"

ALT=$(echo "$CHAINS" | tr ',' '|')
# composed keys `<network>_<dexKey>_<cacheKey>` (RFQ blacklists excluded:
# 1.2M keys of no use here), dex-lib hashes `dl_<network>_…`, master keys
# `is_…`, backend `dexlib:<kind>:<network>:…`
REGEX="^(dl_($ALT)_.*|is_.*|($ALT)_(?!ParaSwapPool).*|dexlib:[a-z_]+:($ALT):.*)$"

if [ ! -s "$WORK/filtered.resp" ]; then
  echo "filtering keys matching $REGEX"
  "$RCT" -f resp -s "$DUMP" -o "$WORK/filtered.resp" -k "$REGEX"
fi
ls -la "$WORK/filtered.resp"

if ! redis-cli -p "$PORT" ping >/dev/null 2>&1; then
  echo "starting redis-server on port $PORT"
  redis-server --port "$PORT" --save "" --appendonly no --dir "$WORK" \
    --daemonize yes --pidfile "$WORK/redis.pid" --logfile "$WORK/redis.log"
  sleep 1
fi

echo "loading"
redis-cli -p "$PORT" --pipe < "$WORK/filtered.resp"
redis-cli -p "$PORT" dbsize
redis-cli -p "$PORT" info memory | grep -E 'used_memory_human|used_memory_rss_human'
for c in $(echo "$CHAINS" | tr ',' ' '); do
  for k in $(redis-cli -p "$PORT" --scan --pattern "dl_${c}_*_pairs") \
           $(redis-cli -p "$PORT" --scan --pattern "dl_${c}_*_pools"); do
    printf '%-45s %s\n' "$k" "$(redis-cli -p "$PORT" hlen "$k")"
  done
  printf 'is_%s_bn = %s\n' "$c" "$(redis-cli -p "$PORT" get "is_${c}_bn")"
done
