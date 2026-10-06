import { EventFragment, Interface, LogDescription } from '@ethersproject/abi';
import { deepCopy } from 'ethers/lib/utils';

type DecodableLog = {
  topics: string[];
  data: string;
};

type TopicEntry = {
  eventFragment: EventFragment;
  name: string;
  signature: string;
  topic: string;
};

/**
 * `Interface.parseLog` resolves `topics[0]` by formatting and keccak hashing
 * every event fragment of the ABI until one matches, then deep copies the
 * result into a `LogDescription`. Both costs are paid on every single log, and
 * the first one grows with the size of the ABI.
 *
 * This decoder builds the `topic0 -> fragment` map once and resolves a log with
 * a single map lookup, reusing the name/signature/topic computed at build time.
 *
 * `args` is deep copied exactly like `parseLog` does, so consumers see the same
 * values. The one deviation is `eventFragment`: `parseLog` hands out a deep
 * copy of the fragment, this decoder hands out the fragment itself. Copying it
 * per log is the most expensive part of that deep copy, and nothing reads
 * `eventFragment` off a decoded log.
 */
export class TopicLogDecoder {
  private readonly byTopic = new Map<string, TopicEntry>();

  constructor(private readonly iface: Interface) {
    for (const name of Object.keys(iface.events)) {
      const eventFragment = iface.events[name];
      // Anonymous events have no topic0 to look up: the fallback below leaves
      // them to `parseLog`.
      if (eventFragment.anonymous) continue;

      const topic = iface.getEventTopic(eventFragment);
      this.byTopic.set(topic, {
        eventFragment,
        name: eventFragment.name,
        signature: eventFragment.format(),
        topic,
      });
    }
  }

  decode(log: DecodableLog): LogDescription {
    const entry = this.getEntry(log.topics[0]);
    if (entry === undefined) {
      // Unknown, anonymous or malformed topic: delegate, so callers keep
      // seeing ethers' own error (they branch on `no matching event`).
      return this.iface.parseLog(log);
    }

    return {
      eventFragment: entry.eventFragment,
      name: entry.name,
      signature: entry.signature,
      topic: entry.topic,
      args: deepCopy(
        this.iface.decodeEventLog(entry.eventFragment, log.data, log.topics),
      ),
    };
  }

  private getEntry(topic0: string): TopicEntry | undefined {
    const entry = this.byTopic.get(topic0);
    if (entry !== undefined) return entry;
    // Topics come lowercased in practice; `getEvent` accepts any case.
    return typeof topic0 === 'string'
      ? this.byTopic.get(topic0.toLowerCase())
      : undefined;
  }
}

const decoders = new WeakMap<Interface, TopicLogDecoder>();

/**
 * Returns the shared `TopicLogDecoder` of an `Interface`, building it on first
 * use. Interfaces shared across pools (`erc20Iface`, ...) therefore share a
 * single topic map.
 */
export function getTopicLogDecoder(iface: Interface): TopicLogDecoder {
  let decoder = decoders.get(iface);
  if (decoder === undefined) {
    decoder = new TopicLogDecoder(iface);
    decoders.set(iface, decoder);
  }
  return decoder;
}
