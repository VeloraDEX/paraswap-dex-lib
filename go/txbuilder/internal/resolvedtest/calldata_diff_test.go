package resolvedtest

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/testfixtures"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestGenericCalldataDiffReturnsEmptyForEqualBytesWithoutABI(t *testing.T) {
	data := resolved.HexBytes("0x12345678")

	if diff := GenericCalldataDiff(nil, resolved.ContractMethodSwapExactAmountIn, "equal", data, data); diff != "" {
		t.Fatalf("expected empty diff, got %s", diff)
	}
}

func TestGenericCalldataDiffTreatsHexCaseAsMismatch(t *testing.T) {
	got := resolved.HexBytes("0xABCDEF12")
	expected := resolved.HexBytes("0xabcdef12")

	diff := GenericCalldataDiff(nil, resolved.ContractMethodSwapExactAmountIn, "case", got, expected)
	if diff == "" {
		t.Fatal("expected case mismatch diff")
	}
	if !strings.Contains(diff, "raw: decoded bytes match") {
		t.Fatalf("expected decoded-byte match context for case-only mismatch, got:\n%s", diff)
	}
}

func TestGenericCalldataDiffReportsSelectorMismatchWithoutDecodedFields(t *testing.T) {
	augustusABI, err := resolved.LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	expected := loadFixtureCalldata(t, "executor01-simple-sell-approved")
	got := replaceSelector(t, expected, "0x00000000")

	diff := GenericCalldataDiff(
		augustusABI,
		resolved.ContractMethodSwapExactAmountIn,
		"executor01-simple-sell-approved",
		got,
		expected,
	)

	if !strings.Contains(diff, "selector mismatch") {
		t.Fatalf("expected selector mismatch, got:\n%s", diff)
	}
	if !strings.Contains(diff, "got=0x00000000 (unknown)") {
		t.Fatalf("expected unknown got selector name, got:\n%s", diff)
	}
	if strings.Contains(diff, "swapData.") {
		t.Fatalf("selector mismatch should not include decoded field diffs:\n%s", diff)
	}
}

func TestGenericCalldataDiffReportsDecodedPartnerAndFeeMismatch(t *testing.T) {
	augustusABI, err := resolved.LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	expected := loadFixtureCalldata(t, "executor01-simple-sell-approved")
	got := replaceStaticWord(t, expected, 8, "0000000000000000000000000000000000000000000000000000000000000001")

	diff := GenericCalldataDiff(
		augustusABI,
		resolved.ContractMethodSwapExactAmountIn,
		"executor01-simple-sell-approved",
		got,
		expected,
	)

	if !strings.Contains(diff, "selector: 0xe3ead59e (swapExactAmountIn) ok") {
		t.Fatalf("expected selector ok line, got:\n%s", diff)
	}
	if !strings.Contains(diff, "partnerAndFee: got=1 want=4951760157141521099596496896") {
		t.Fatalf("expected partnerAndFee diff, got:\n%s", diff)
	}
	if !strings.Contains(diff, "raw: first byte diff at") {
		t.Fatalf("expected raw byte context, got:\n%s", diff)
	}
}

func TestGenericCalldataDiffReportsExecutorDataByteMismatch(t *testing.T) {
	augustusABI, err := resolved.LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	expected := loadFixtureCalldata(t, "executor01-simple-sell-approved")
	got := replaceLastByte(t, expected)

	diff := GenericCalldataDiff(
		augustusABI,
		resolved.ContractMethodSwapExactAmountIn,
		"executor01-simple-sell-approved",
		got,
		expected,
	)

	if !strings.Contains(diff, "executorData: first diff at byte") {
		t.Fatalf("expected executorData byte diff, got:\n%s", diff)
	}
	if !strings.Contains(diff, "raw: first byte diff at") {
		t.Fatalf("expected raw byte context, got:\n%s", diff)
	}
}

func TestGenericCalldataDiffReportsExecutorDataLengthMismatchWithOffset(t *testing.T) {
	augustusABI, err := resolved.LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	expected := loadFixtureCalldata(t, "executor01-simple-sell-approved")
	got := appendExecutorDataByte(t, augustusABI, resolved.ContractMethodSwapExactAmountIn, expected)

	diff := GenericCalldataDiff(
		augustusABI,
		resolved.ContractMethodSwapExactAmountIn,
		"executor01-simple-sell-approved",
		got,
		expected,
	)

	if !strings.Contains(diff, "executorData: lengths differ at byte") {
		t.Fatalf("expected executorData length diff with offset, got:\n%s", diff)
	}
	if !strings.Contains(diff, "raw: first byte diff at") {
		t.Fatalf("expected raw byte context, got:\n%s", diff)
	}
}

func TestRawCalldataDiffReportsLengthsForSameLengthMismatch(t *testing.T) {
	augustusABI, err := resolved.LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	expected := loadFixtureCalldata(t, "uniswap-v2-sell")
	got := replaceLastByte(t, expected)
	expectedBytes, err := decodeCalldataBytes(expected)
	if err != nil {
		t.Fatal(err)
	}

	diff := RawCalldataDiff(
		augustusABI,
		resolved.ContractMethodSwapExactAmountInOnUniswapV2,
		"uniswap-v2-sell",
		got,
		expected,
	)

	wantLengthLine := fmt.Sprintf("length: got=%d want=%d", len(expectedBytes), len(expectedBytes))
	if !strings.Contains(diff, wantLengthLine) {
		t.Fatalf("expected length line %q, got:\n%s", wantLengthLine, diff)
	}
	if !strings.Contains(diff, "raw: first byte diff at") {
		t.Fatalf("expected raw byte context, got:\n%s", diff)
	}
}

func loadFixtureCalldata(t *testing.T, name string) resolved.HexBytes {
	t.Helper()

	collection, err := testfixtures.LoadResolvedBuildFixtures()
	if err != nil {
		t.Fatal(err)
	}
	fixture, ok := collection.FixtureByName(name)
	if !ok {
		t.Fatalf("expected %s fixture", name)
	}
	var expectedTx resolved.TxObject
	if err := json.Unmarshal(fixture.ExpectedTx, &expectedTx); err != nil {
		t.Fatal(err)
	}
	return expectedTx.Data
}

func replaceSelector(t *testing.T, calldata resolved.HexBytes, selector string) resolved.HexBytes {
	t.Helper()

	raw := string(calldata)
	normalizedSelector := strings.TrimPrefix(selector, "0x")
	if !strings.HasPrefix(raw, "0x") || len(raw) < 10 {
		t.Fatalf("invalid calldata: %s", raw)
	}
	if len(normalizedSelector) != 8 {
		t.Fatalf("selector must be 4 bytes, got %s", selector)
	}
	if _, err := hex.DecodeString(normalizedSelector); err != nil {
		t.Fatalf("selector must be hex, got %s: %v", selector, err)
	}
	return resolved.HexBytes("0x" + strings.ToLower(normalizedSelector) + raw[10:])
}

func replaceStaticWord(t *testing.T, calldata resolved.HexBytes, slot int, word string) resolved.HexBytes {
	t.Helper()

	raw := string(calldata)
	if !strings.HasPrefix(raw, "0x") {
		t.Fatalf("invalid calldata: %s", raw)
	}
	normalizedWord := strings.TrimPrefix(strings.ToLower(word), "0x")
	if len(normalizedWord) != 64 {
		t.Fatalf("word must be 32 bytes, got %s", word)
	}
	if _, err := hex.DecodeString(normalizedWord); err != nil {
		t.Fatalf("word must be hex, got %s: %v", word, err)
	}
	start := len("0x") + 8 + slot*64
	end := start + 64
	if end > len(raw) {
		t.Fatalf("slot %d is outside calldata length %d", slot, len(raw))
	}
	return resolved.HexBytes(raw[:start] + normalizedWord + raw[end:])
}

func replaceLastByte(t *testing.T, calldata resolved.HexBytes) resolved.HexBytes {
	t.Helper()

	raw := string(calldata)
	if !strings.HasPrefix(raw, "0x") || len(raw) < 4 {
		t.Fatalf("invalid calldata: %s", raw)
	}
	replacement := "00"
	if raw[len(raw)-2:] == "00" {
		replacement = "01"
	}
	return resolved.HexBytes(raw[:len(raw)-2] + replacement)
}

func appendExecutorDataByte(
	t *testing.T,
	augustusABI *ethabi.ABI,
	contractMethod string,
	calldata resolved.HexBytes,
) resolved.HexBytes {
	t.Helper()

	method, ok := augustusABI.Methods[contractMethod]
	if !ok {
		t.Fatalf("missing ABI method %s", contractMethod)
	}
	calldataBytes, err := decodeCalldataBytes(calldata)
	if err != nil {
		t.Fatal(err)
	}
	values, err := method.Inputs.Unpack(calldataBytes[4:])
	if err != nil {
		t.Fatal(err)
	}
	executorData, ok := values[4].([]byte)
	if !ok {
		t.Fatalf("executorData has unexpected type %T", values[4])
	}
	values[4] = append(append([]byte(nil), executorData...), 0xff)
	packed, err := method.Inputs.Pack(values...)
	if err != nil {
		t.Fatal(err)
	}
	out := append(append([]byte(nil), method.ID...), packed...)
	return resolved.HexBytes("0x" + hex.EncodeToString(out))
}
