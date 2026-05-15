package resolved

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

type genericSwapDataABI struct {
	SrcToken     common.Address `abi:"srcToken"`
	DestToken    common.Address `abi:"destToken"`
	FromAmount   *big.Int       `abi:"fromAmount"`
	ToAmount     *big.Int       `abi:"toAmount"`
	QuotedAmount *big.Int       `abi:"quotedAmount"`
	Metadata     [32]byte       `abi:"metadata"`
	Beneficiary  common.Address `abi:"beneficiary"`
}

func encodeGenericCalldata(
	input BuildInput,
	fee FeeInput,
	bytecode HexBytes,
	augustusV6ABI *ethabi.ABI,
) (HexBytes, error) {
	if augustusV6ABI == nil {
		return "", fmt.Errorf("Augustus V6 ABI is required")
	}

	method, ok := augustusV6ABI.Methods[input.ContractMethod]
	if !ok {
		return "", fmt.Errorf("Augustus V6 method not found: %s", input.ContractMethod)
	}

	swapData, err := buildGenericSwapDataABI(input)
	if err != nil {
		return "", err
	}

	partnerAndFee, err := BuildFeesV6(fee)
	if err != nil {
		return "", err
	}

	permitBytes, err := decodeHexBytes(input.Permit, "permit")
	if err != nil {
		return "", err
	}
	bytecodeBytes, err := decodeHexBytes(bytecode, "executorData")
	if err != nil {
		return "", err
	}

	packed, err := method.Inputs.Pack(
		common.HexToAddress(string(input.ExecutorAddress)),
		swapData,
		partnerAndFee,
		permitBytes,
		bytecodeBytes,
	)
	if err != nil {
		return "", fmt.Errorf("encode %s calldata: %w", input.ContractMethod, err)
	}

	calldata := make([]byte, 0, len(method.ID)+len(packed))
	calldata = append(calldata, method.ID...)
	calldata = append(calldata, packed...)

	return HexBytes("0x" + hex.EncodeToString(calldata)), nil
}

func buildGenericSwapDataABI(input BuildInput) (genericSwapDataABI, error) {
	var fromAmountValue DecimalString
	var toAmountValue DecimalString
	switch input.Side {
	case SideSell:
		fromAmountValue = input.SrcAmount
		toAmountValue = input.MinMaxAmount
	case SideBuy:
		fromAmountValue = input.MinMaxAmount
		toAmountValue = input.DestAmount
	default:
		return genericSwapDataABI{}, fmt.Errorf("side must be SELL or BUY: %s", input.Side)
	}

	fromAmount, err := parseUint256(fromAmountValue, "fromAmount")
	if err != nil {
		return genericSwapDataABI{}, err
	}
	toAmount, err := parseUint256(toAmountValue, "toAmount")
	if err != nil {
		return genericSwapDataABI{}, err
	}
	quotedAmount, err := parseUint256(input.QuotedAmount, "quotedAmount")
	if err != nil {
		return genericSwapDataABI{}, err
	}
	metadataHex, err := PackUUIDAndBlock(input.UUID, input.BlockNumber)
	if err != nil {
		return genericSwapDataABI{}, err
	}
	metadataBytes, err := decodeHexBytes(HexBytes(metadataHex), "metadata")
	if err != nil {
		return genericSwapDataABI{}, err
	}
	if len(metadataBytes) != 32 {
		return genericSwapDataABI{}, fmt.Errorf("metadata must encode exactly 32 bytes")
	}
	var metadata [32]byte
	copy(metadata[:], metadataBytes)

	return genericSwapDataABI{
		SrcToken:     common.HexToAddress(string(input.SrcToken)),
		DestToken:    common.HexToAddress(string(input.DestToken)),
		FromAmount:   fromAmount,
		ToAmount:     toAmount,
		QuotedAmount: quotedAmount,
		Metadata:     metadata,
		Beneficiary:  common.HexToAddress(string(input.Beneficiary)),
	}, nil
}

func parseUint256(value DecimalString, field string) (*big.Int, error) {
	out, ok := new(big.Int).SetString(string(value), 10)
	if !ok || out.Sign() < 0 {
		return nil, fmt.Errorf("%s must be a non-negative decimal integer: %s", field, value)
	}
	return out, nil
}

func decodeHexBytes(value HexBytes, field string) ([]byte, error) {
	raw := string(value)
	if !strings.HasPrefix(raw, "0x") {
		return nil, fmt.Errorf("%s must be 0x-prefixed hex bytes", field)
	}
	out, err := hex.DecodeString(raw[2:])
	if err != nil {
		return nil, fmt.Errorf("%s must be 0x-prefixed hex bytes", field)
	}
	return out, nil
}
