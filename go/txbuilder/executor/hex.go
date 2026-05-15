package executor

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func concatHex(parts ...string) (resolved.HexBytes, error) {
	var out []byte
	for _, part := range parts {
		bytes, err := decodeHex(part)
		if err != nil {
			return "", err
		}
		out = append(out, bytes...)
	}
	return resolved.HexBytes("0x" + hex.EncodeToString(out)), nil
}

func decodeHex(value string) ([]byte, error) {
	raw := strip0x(value)
	if len(raw)%2 != 0 {
		return nil, fmt.Errorf("hex value must have even length: %s", value)
	}
	bytes, err := hex.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid hex value %s: %w", value, err)
	}
	return bytes, nil
}

func hexDataLength(value string) (int, error) {
	bytes, err := decodeHex(value)
	if err != nil {
		return 0, err
	}
	return len(bytes), nil
}

func strip0x(value string) string {
	if strings.HasPrefix(value, "0x") || strings.HasPrefix(value, "0X") {
		return value[2:]
	}
	return value
}

func lowerHex(value string) string {
	if value == "" {
		return value
	}
	return "0x" + strings.ToLower(strip0x(value))
}

func leftPadUint(value int, width int) (string, error) {
	if value < 0 {
		return "", fmt.Errorf("cannot pack negative value %d", value)
	}
	return leftPadBig(new(big.Int).SetInt64(int64(value)), width)
}

func leftPadBig(value *big.Int, width int) (string, error) {
	if value.Sign() < 0 {
		return "", fmt.Errorf("cannot pack negative value %s", value.String())
	}
	bytes := value.Bytes()
	if len(bytes) > width {
		return "", fmt.Errorf("value %s does not fit in %d bytes", value.String(), width)
	}
	out := make([]byte, width)
	copy(out[width-len(bytes):], bytes)
	return "0x" + hex.EncodeToString(out), nil
}

func encodeUint256Decimal(value resolved.DecimalString) (string, error) {
	parsed, ok := new(big.Int).SetString(string(value), 10)
	if !ok || parsed.Sign() < 0 {
		return "", fmt.Errorf("amount must be a non-negative decimal integer: %s", value)
	}
	return leftPadBig(parsed, 32)
}

func encodeNegativeInt256Decimal(value resolved.DecimalString) (string, error) {
	parsed, ok := new(big.Int).SetString(string(value), 10)
	if !ok || parsed.Sign() < 0 {
		return "", fmt.Errorf("amount must be a non-negative decimal integer: %s", value)
	}
	modulus := new(big.Int).Lsh(big.NewInt(1), 256)
	encoded := new(big.Int).Sub(modulus, parsed)
	return leftPadBig(encoded, 32)
}

func zeroBytes(width int) string {
	return "0x" + strings.Repeat("00", width)
}
