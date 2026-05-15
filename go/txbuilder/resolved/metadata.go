package resolved

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
)

func PackUUIDAndBlock(uuid string, blockNumber int64) (string, error) {
	if blockNumber < 0 {
		return "", fmt.Errorf("blockNumber must be non-negative: %d", blockNumber)
	}

	uuidHex := strings.ReplaceAll(uuid, "-", "")
	if len(uuidHex) != 32 {
		return "", fmt.Errorf("uuid must encode exactly 16 bytes: %s", uuid)
	}

	uuidBytes, err := hex.DecodeString(uuidHex)
	if err != nil {
		return "", fmt.Errorf("parse uuid: %w", err)
	}
	if len(uuidBytes) != 16 {
		return "", fmt.Errorf("uuid must encode exactly 16 bytes: %s", uuid)
	}

	blockBytes := make([]byte, 16)
	new(big.Int).SetInt64(blockNumber).FillBytes(blockBytes)

	out := make([]byte, 0, 32)
	out = append(out, uuidBytes...)
	out = append(out, blockBytes...)

	return "0x" + hex.EncodeToString(out), nil
}
