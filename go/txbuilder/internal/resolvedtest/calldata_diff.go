package resolvedtest

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"reflect"
	"strings"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type decodedGenericCalldata struct {
	Executor      string
	SwapData      decodedGenericSwapData
	PartnerAndFee string
	Permit        []byte
	ExecutorData  []byte
}

type decodedGenericSwapData struct {
	SrcToken     string
	DestToken    string
	FromAmount   string
	ToAmount     string
	QuotedAmount string
	Metadata     string
	Beneficiary  string
}

// GenericCalldataDiff returns an empty string when calldata is byte-identical.
// It is scoped to the four Augustus V6 generic In/Out/InPro/OutPro methods.
// On mismatch it includes decoded generic arguments when the selectors agree,
// plus raw byte context for the first difference.
func GenericCalldataDiff(
	augustusV6ABI *ethabi.ABI,
	contractMethod string,
	fixtureName string,
	got resolved.HexBytes,
	expected resolved.HexBytes,
) string {
	if strings.EqualFold(string(got), string(expected)) {
		return ""
	}

	header := fmt.Sprintf("calldata mismatch (%s, %s)", fixtureName, contractMethod)
	gotBytes, gotErr := decodeCalldataBytes(got)
	expectedBytes, expectedErr := decodeCalldataBytes(expected)
	if gotErr != nil || expectedErr != nil {
		return strings.Join([]string{
			header,
			fmt.Sprintf("  decode calldata bytes: got=%v want=%v", gotErr, expectedErr),
			rawByteDiffLine(gotBytes, expectedBytes),
		}, "\n")
	}

	gotSelector := selectorHex(gotBytes)
	expectedSelector := selectorHex(expectedBytes)
	if gotSelector != expectedSelector {
		return strings.Join([]string{
			header,
			fmt.Sprintf(
				"  selector mismatch: got=%s (%s) want=%s (%s)",
				gotSelector,
				methodNameForSelector(augustusV6ABI, gotSelector),
				expectedSelector,
				methodNameForSelector(augustusV6ABI, expectedSelector),
			),
			rawByteDiffLine(gotBytes, expectedBytes),
		}, "\n")
	}

	methodSelector, methodErr := methodSelectorHex(augustusV6ABI, contractMethod)
	if methodErr != nil {
		return strings.Join([]string{
			header,
			fmt.Sprintf("  method lookup: %v", methodErr),
			rawByteDiffLine(gotBytes, expectedBytes),
		}, "\n")
	}
	if gotSelector != methodSelector {
		return strings.Join([]string{
			header,
			fmt.Sprintf(
				"  selector mismatch: got=%s (%s) want=%s (%s)",
				gotSelector,
				methodNameForSelector(augustusV6ABI, gotSelector),
				methodSelector,
				contractMethod,
			),
			rawByteDiffLine(gotBytes, expectedBytes),
		}, "\n")
	}

	gotDecoded, gotErr := decodeGenericCalldata(augustusV6ABI, contractMethod, gotBytes)
	expectedDecoded, expectedErr := decodeGenericCalldata(augustusV6ABI, contractMethod, expectedBytes)
	if gotErr != nil || expectedErr != nil {
		return strings.Join([]string{
			header,
			fmt.Sprintf("  decode generic arguments: got=%v want=%v", gotErr, expectedErr),
			rawByteDiffLine(gotBytes, expectedBytes),
		}, "\n")
	}

	lines := []string{header, fmt.Sprintf("  selector: %s (%s) ok", gotSelector, contractMethod)}
	lines = append(lines, decodedGenericDiffLines(gotDecoded, expectedDecoded)...)
	lines = append(lines, "  "+rawByteDiffLine(gotBytes, expectedBytes))
	return strings.Join(lines, "\n")
}

func decodeCalldataBytes(calldata resolved.HexBytes) ([]byte, error) {
	raw := string(calldata)
	if !strings.HasPrefix(raw, "0x") {
		return nil, fmt.Errorf("missing 0x prefix")
	}
	if len(raw) < 10 {
		return nil, fmt.Errorf("calldata shorter than selector")
	}
	if len(raw[2:])%2 != 0 {
		return nil, fmt.Errorf("odd-length hex")
	}
	out, err := hex.DecodeString(raw[2:])
	if err != nil {
		return nil, err
	}
	if len(out) < 4 {
		return nil, fmt.Errorf("calldata shorter than selector")
	}
	return out, nil
}

func selectorHex(calldata []byte) string {
	if len(calldata) < 4 {
		return "0x"
	}
	return "0x" + hex.EncodeToString(calldata[:4])
}

func methodSelectorHex(augustusV6ABI *ethabi.ABI, contractMethod string) (string, error) {
	if augustusV6ABI == nil {
		return "", fmt.Errorf("Augustus V6 ABI is required")
	}
	method, ok := augustusV6ABI.Methods[contractMethod]
	if !ok {
		return "", fmt.Errorf("Augustus V6 method not found: %s", contractMethod)
	}
	return "0x" + hex.EncodeToString(method.ID), nil
}

func methodNameForSelector(augustusV6ABI *ethabi.ABI, selector string) string {
	if augustusV6ABI == nil {
		return "unknown"
	}
	normalized := strings.TrimPrefix(strings.ToLower(selector), "0x")
	for name, method := range augustusV6ABI.Methods {
		if hex.EncodeToString(method.ID) == normalized {
			return name
		}
	}
	return "unknown"
}

func decodeGenericCalldata(
	augustusV6ABI *ethabi.ABI,
	contractMethod string,
	calldata []byte,
) (decodedGenericCalldata, error) {
	if augustusV6ABI == nil {
		return decodedGenericCalldata{}, fmt.Errorf("Augustus V6 ABI is required")
	}
	method, ok := augustusV6ABI.Methods[contractMethod]
	if !ok {
		return decodedGenericCalldata{}, fmt.Errorf("Augustus V6 method not found: %s", contractMethod)
	}
	values, err := method.Inputs.Unpack(calldata[4:])
	if err != nil {
		return decodedGenericCalldata{}, err
	}
	if len(values) != 5 {
		return decodedGenericCalldata{}, fmt.Errorf("expected 5 inputs, got %d", len(values))
	}

	executor, err := normalizeAddress(values[0])
	if err != nil {
		return decodedGenericCalldata{}, fmt.Errorf("executor: %w", err)
	}
	swapData, err := decodeGenericSwapData(values[1])
	if err != nil {
		return decodedGenericCalldata{}, fmt.Errorf("swapData: %w", err)
	}
	partnerAndFee, err := normalizeUint256(values[2])
	if err != nil {
		return decodedGenericCalldata{}, fmt.Errorf("partnerAndFee: %w", err)
	}
	permit, err := normalizeBytesValue(values[3])
	if err != nil {
		return decodedGenericCalldata{}, fmt.Errorf("permit: %w", err)
	}
	executorData, err := normalizeBytesValue(values[4])
	if err != nil {
		return decodedGenericCalldata{}, fmt.Errorf("executorData: %w", err)
	}

	return decodedGenericCalldata{
		Executor:      executor,
		SwapData:      swapData,
		PartnerAndFee: partnerAndFee,
		Permit:        permit,
		ExecutorData:  executorData,
	}, nil
}

func decodeGenericSwapData(value any) (decodedGenericSwapData, error) {
	srcToken, err := normalizeAddress(tupleValue(value, "SrcToken", 0))
	if err != nil {
		return decodedGenericSwapData{}, fmt.Errorf("srcToken: %w", err)
	}
	destToken, err := normalizeAddress(tupleValue(value, "DestToken", 1))
	if err != nil {
		return decodedGenericSwapData{}, fmt.Errorf("destToken: %w", err)
	}
	fromAmount, err := normalizeUint256(tupleValue(value, "FromAmount", 2))
	if err != nil {
		return decodedGenericSwapData{}, fmt.Errorf("fromAmount: %w", err)
	}
	toAmount, err := normalizeUint256(tupleValue(value, "ToAmount", 3))
	if err != nil {
		return decodedGenericSwapData{}, fmt.Errorf("toAmount: %w", err)
	}
	quotedAmount, err := normalizeUint256(tupleValue(value, "QuotedAmount", 4))
	if err != nil {
		return decodedGenericSwapData{}, fmt.Errorf("quotedAmount: %w", err)
	}
	metadata, err := normalizeBytes32(tupleValue(value, "Metadata", 5))
	if err != nil {
		return decodedGenericSwapData{}, fmt.Errorf("metadata: %w", err)
	}
	beneficiary, err := normalizeAddress(tupleValue(value, "Beneficiary", 6))
	if err != nil {
		return decodedGenericSwapData{}, fmt.Errorf("beneficiary: %w", err)
	}

	return decodedGenericSwapData{
		SrcToken:     srcToken,
		DestToken:    destToken,
		FromAmount:   fromAmount,
		ToAmount:     toAmount,
		QuotedAmount: quotedAmount,
		Metadata:     metadata,
		Beneficiary:  beneficiary,
	}, nil
}

func tupleValue(value any, fieldName string, index int) any {
	rv := reflect.ValueOf(value)
	for rv.Kind() == reflect.Pointer || rv.Kind() == reflect.Interface {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	switch rv.Kind() {
	case reflect.Struct:
		field := rv.FieldByName(fieldName)
		if !field.IsValid() || !field.CanInterface() {
			return nil
		}
		return field.Interface()
	case reflect.Slice, reflect.Array:
		if index < 0 || index >= rv.Len() {
			return nil
		}
		return rv.Index(index).Interface()
	default:
		return nil
	}
}

func normalizeAddress(value any) (string, error) {
	switch typed := value.(type) {
	case common.Address:
		return "0x" + hex.EncodeToString(typed[:]), nil
	case *common.Address:
		if typed == nil {
			return "", fmt.Errorf("nil address")
		}
		return "0x" + hex.EncodeToString(typed[:]), nil
	case string:
		return strings.ToLower(typed), nil
	default:
		rv := reflect.ValueOf(value)
		if rv.IsValid() && rv.Kind() == reflect.Array && rv.Len() == common.AddressLength {
			out := make([]byte, common.AddressLength)
			for i := range out {
				item := rv.Index(i)
				if item.Kind() != reflect.Uint8 {
					return "", fmt.Errorf("unsupported address element type %T", value)
				}
				out[i] = byte(item.Uint())
			}
			return "0x" + hex.EncodeToString(out), nil
		}
		return "", fmt.Errorf("unsupported address type %T", value)
	}
}

func normalizeUint256(value any) (string, error) {
	switch typed := value.(type) {
	case *big.Int:
		if typed == nil {
			return "", fmt.Errorf("nil uint256")
		}
		return typed.String(), nil
	case big.Int:
		return typed.String(), nil
	case string:
		return typed, nil
	default:
		return "", fmt.Errorf("unsupported uint256 type %T", value)
	}
}

func normalizeBytes32(value any) (string, error) {
	switch typed := value.(type) {
	case [32]byte:
		return "0x" + hex.EncodeToString(typed[:]), nil
	case []byte:
		if len(typed) != 32 {
			return "", fmt.Errorf("expected 32 bytes, got %d", len(typed))
		}
		return "0x" + hex.EncodeToString(typed), nil
	default:
		rv := reflect.ValueOf(value)
		if rv.IsValid() && rv.Kind() == reflect.Array && rv.Len() == 32 {
			out := make([]byte, 32)
			for i := range out {
				item := rv.Index(i)
				if item.Kind() != reflect.Uint8 {
					return "", fmt.Errorf("unsupported bytes32 element type %T", value)
				}
				out[i] = byte(item.Uint())
			}
			return "0x" + hex.EncodeToString(out), nil
		}
		return "", fmt.Errorf("unsupported bytes32 type %T", value)
	}
}

func normalizeBytesValue(value any) ([]byte, error) {
	typed, ok := value.([]byte)
	if !ok {
		return nil, fmt.Errorf("unsupported bytes type %T", value)
	}
	return typed, nil
}

func decodedGenericDiffLines(got decodedGenericCalldata, expected decodedGenericCalldata) []string {
	var lines []string
	appendStringDiff(&lines, "executor", got.Executor, expected.Executor)
	appendStringDiff(&lines, "swapData.srcToken", got.SwapData.SrcToken, expected.SwapData.SrcToken)
	appendStringDiff(&lines, "swapData.destToken", got.SwapData.DestToken, expected.SwapData.DestToken)
	appendStringDiff(&lines, "swapData.fromAmount", got.SwapData.FromAmount, expected.SwapData.FromAmount)
	appendStringDiff(&lines, "swapData.toAmount", got.SwapData.ToAmount, expected.SwapData.ToAmount)
	appendStringDiff(&lines, "swapData.quotedAmount", got.SwapData.QuotedAmount, expected.SwapData.QuotedAmount)
	appendStringDiff(&lines, "swapData.metadata", got.SwapData.Metadata, expected.SwapData.Metadata)
	appendStringDiff(&lines, "swapData.beneficiary", got.SwapData.Beneficiary, expected.SwapData.Beneficiary)
	appendStringDiff(&lines, "partnerAndFee", got.PartnerAndFee, expected.PartnerAndFee)
	appendBytesDiff(&lines, "permit", got.Permit, expected.Permit)
	appendBytesDiff(&lines, "executorData", got.ExecutorData, expected.ExecutorData)
	if len(lines) == 0 {
		lines = append(lines, "  decoded fields match; raw bytes differ")
	}
	return lines
}

func appendStringDiff(lines *[]string, label string, got string, expected string) {
	if got == expected {
		return
	}
	*lines = append(*lines, fmt.Sprintf("  %s: got=%s want=%s", label, got, expected))
}

func appendBytesDiff(lines *[]string, label string, got []byte, expected []byte) {
	if string(got) == string(expected) {
		return
	}
	if len(got) == 0 && len(expected) == 0 {
		return
	}
	if len(got) != len(expected) {
		offset, _ := firstByteDiff(got, expected)
		*lines = append(
			*lines,
			fmt.Sprintf(
				"  %s: lengths differ at byte %d, got=%d (%s) want=%d (%s)",
				label,
				offset,
				len(got),
				formatBytesForDiff(got),
				len(expected),
				formatBytesForDiff(expected),
			),
		)
		return
	}
	// Equal-length byte slices reach this point only when at least one byte differs.
	offset, _ := firstByteDiff(got, expected)
	*lines = append(
		*lines,
		fmt.Sprintf(
			"  %s: first diff at byte %d (length=%d), got=%s want=%s",
			label,
			offset,
			len(got),
			hexWindow(got, offset),
			hexWindow(expected, offset),
		),
	)
}

func rawByteDiffLine(got []byte, expected []byte) string {
	offset, ok := firstByteDiff(got, expected)
	if !ok {
		return "raw: decoded bytes match"
	}
	if len(got) != len(expected) && offset == minInt(len(got), len(expected)) {
		return fmt.Sprintf("raw: lengths differ at byte %d, got=%d want=%d", offset, len(got), len(expected))
	}
	return fmt.Sprintf(
		"raw: first byte diff at %d, got=%s want=%s",
		offset,
		hexWindow(got, offset),
		hexWindow(expected, offset),
	)
}

func formatBytesForDiff(value []byte) string {
	if len(value) == 0 {
		return "0x (empty)"
	}
	if len(value) <= 16 {
		return "0x" + hex.EncodeToString(value)
	}
	return fmt.Sprintf("%s...%s", hexWindow(value, 0), hexWindow(value, len(value)-1))
}

func firstByteDiff(got []byte, expected []byte) (int, bool) {
	limit := minInt(len(got), len(expected))
	for i := 0; i < limit; i++ {
		if got[i] != expected[i] {
			return i, true
		}
	}
	if len(got) != len(expected) {
		return limit, true
	}
	return 0, false
}

func hexWindow(value []byte, offset int) string {
	if len(value) == 0 {
		return "0x"
	}
	start := offset - 4
	if start < 0 {
		start = 0
	}
	end := offset + 5
	if end > len(value) {
		end = len(value)
	}
	return "0x" + hex.EncodeToString(value[start:end])
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
