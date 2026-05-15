package tessera

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/dexencodertest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

const (
	baseWETH = resolved.Address("0x4200000000000000000000000000000000000006")
	bscWBNB  = resolved.Address("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c")
)

func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if got := config.RouterByNetwork[NetworkBase]; got != "0x55555522005bcae1c2424d474bfd5ed477749e3e" {
		t.Fatalf("Base router mismatch: %s", got)
	}
	if got := config.RouterByNetwork[NetworkBSC]; got != "0x55555522005bcae1c2424d474bfd5ed477749e3e" {
		t.Fatalf("BSC router mismatch: %s", got)
	}
	if got := config.WrappedNativeByNetwork[NetworkBase]; got != baseWETH {
		t.Fatalf("Base wrapped-native mismatch: %s", got)
	}
	if got := config.WrappedNativeByNetwork[NetworkBSC]; got != bscWBNB {
		t.Fatalf("BSC wrapped-native mismatch: %s", got)
	}
}

func TestTesseraNeedWrapNativeFixtures(t *testing.T) {
	collection, err := dexencodertest.LoadTesseraFixtures(dexencodertest.KindNeedWrapNative)
	if err != nil {
		t.Fatal(err)
	}
	if len(collection.Fixtures) != 12 {
		t.Fatalf("expected 12 Tessera need-wrap fixtures, got %d", len(collection.Fixtures))
	}

	encoder := New(DefaultConfig())
	for _, fixture := range collection.Fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			input, err := dexencodertest.DecodeNeedWrapNativeInput(fixture)
			if err != nil {
				t.Fatal(err)
			}
			expected, err := dexencodertest.DecodeExpectedBool(fixture)
			if err != nil {
				t.Fatal(err)
			}

			got, err := encoder.NeedWrapNative(context.Background(), input)
			if err != nil {
				t.Fatal(err)
			}
			if got != expected {
				t.Fatalf("needWrapNative mismatch: got %t want %t", got, expected)
			}
		})
	}
}

func TestTesseraDexParamFixtures(t *testing.T) {
	collection, err := dexencodertest.LoadTesseraFixtures(dexencodertest.KindDexParam)
	if err != nil {
		t.Fatal(err)
	}
	if len(collection.Fixtures) != 12 {
		t.Fatalf("expected 12 Tessera dex-param fixtures, got %d", len(collection.Fixtures))
	}

	encoder := New(DefaultConfig())
	for _, fixture := range collection.Fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			input, err := dexencodertest.DecodeDexParamInput(fixture)
			if err != nil {
				t.Fatal(err)
			}
			expected, err := dexencodertest.DecodeExpectedDexExchangeParam(fixture)
			if err != nil {
				t.Fatal(err)
			}

			got, err := encoder.GetDexParam(context.Background(), input)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, expected) {
				t.Fatalf(
					"dex param mismatch\n%s\n got: %#v\nwant: %#v",
					tesseraCalldataDiff(fixture.Name, got.ExchangeData, expected.ExchangeData),
					got,
					expected,
				)
			}
		})
	}
}

func TestTesseraSellHappyPath(t *testing.T) {
	input := tesseraInput(NetworkBase, resolved.SideSell, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", baseWETH, "1000000", "420526831788390")
	param := mustGetDexParam(t, New(DefaultConfig()), input)
	decoded := mustDecodeTesseraCall(t, param.ExchangeData)

	if decoded.AmountSpecified != "1000000" || decoded.AmountCheck != "0" {
		t.Fatalf("amounts mismatch: got specified=%s check=%s", decoded.AmountSpecified, decoded.AmountCheck)
	}
	if len(decoded.SwapData) != 0 {
		t.Fatalf("expected empty swapData, got %x", decoded.SwapData)
	}
}

func TestTesseraBuyHappyPath(t *testing.T) {
	input := tesseraInput(NetworkBase, resolved.SideBuy, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", baseWETH, "1000000", "420526831788390")
	param := mustGetDexParam(t, New(DefaultConfig()), input)
	decoded := mustDecodeTesseraCall(t, param.ExchangeData)

	if decoded.AmountSpecified != "-420526831788390" || decoded.AmountCheck != "1000000" {
		t.Fatalf("amounts mismatch: got specified=%s check=%s", decoded.AmountSpecified, decoded.AmountCheck)
	}
}

func TestTesseraNativeWrapping(t *testing.T) {
	tests := []struct {
		name      string
		network   int
		srcToken  resolved.Address
		destToken resolved.Address
		wantIn    string
		wantOut   string
	}{
		{
			name:      "Base native source",
			network:   NetworkBase,
			srcToken:  resolved.NativeTokenAddress,
			destToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			wantIn:    string(baseWETH),
			wantOut:   "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
		},
		{
			name:      "Base native destination",
			network:   NetworkBase,
			srcToken:  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			destToken: resolved.NativeTokenAddress,
			wantIn:    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			wantOut:   string(baseWETH),
		},
		{
			name:      "Base wrapped source pass through",
			network:   NetworkBase,
			srcToken:  baseWETH,
			destToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			wantIn:    string(baseWETH),
			wantOut:   "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
		},
		{
			name:      "BSC native source",
			network:   NetworkBSC,
			srcToken:  resolved.NativeTokenAddress,
			destToken: "0x55d398326f99059ff775485246999027b3197955",
			wantIn:    string(bscWBNB),
			wantOut:   "0x55d398326f99059ff775485246999027b3197955",
		},
		{
			name:      "zero address source hardening",
			network:   NetworkBase,
			srcToken:  resolved.NullAddress,
			destToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			wantIn:    string(baseWETH),
			wantOut:   "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
		},
	}

	encoder := New(DefaultConfig())
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			param := mustGetDexParam(t, encoder, tesseraInput(tt.network, resolved.SideSell, tt.srcToken, tt.destToken, "100", "90"))
			decoded := mustDecodeTesseraCall(t, param.ExchangeData)
			if decoded.TokenIn != tt.wantIn || decoded.TokenOut != tt.wantOut {
				t.Fatalf("token mismatch: got in=%s out=%s want in=%s out=%s", decoded.TokenIn, decoded.TokenOut, tt.wantIn, tt.wantOut)
			}
		})
	}
}

func TestTesseraValidationErrors(t *testing.T) {
	encoder := New(DefaultConfig())
	tests := []struct {
		name   string
		input  builder.DexParamInput
		config Config
		want   string
	}{
		{
			name:  "unsupported network",
			input: tesseraInput(999, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "90"),
			want:  "tessera: unsupported chain 999",
		},
		{
			name:  "invalid side",
			input: tesseraInput(NetworkBase, "UNKNOWN", baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "90"),
			want:  "invalid request: tessera unsupported swap side \"UNKNOWN\"",
		},
		{
			name:  "SELL int256 overflow",
			input: tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", resolved.DecimalString(new(big.Int).Add(maxInt256, big.NewInt(1)).String()), "90"),
			want:  "invalid request: tessera srcAmount exceeds int256 maximum",
		},
		{
			name:  "SELL negative srcAmount",
			input: tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "-1", "90"),
			want:  "invalid request: tessera srcAmount must be non-negative",
		},
		{
			name:  "BUY empty destAmount",
			input: tesseraInput(NetworkBase, resolved.SideBuy, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", ""),
			want:  "invalid request: tessera destAmount must be decimal",
		},
		{
			name:  "BUY zero destAmount",
			input: tesseraInput(NetworkBase, resolved.SideBuy, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "0"),
			want:  "invalid request: tessera destAmount must be positive",
		},
		{
			name:  "BUY int256 overflow",
			input: tesseraInput(NetworkBase, resolved.SideBuy, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", resolved.DecimalString(new(big.Int).Add(maxInt256, big.NewInt(1)).String())),
			want:  "invalid request: tessera destAmount exceeds int256 maximum",
		},
		{
			name:  "BUY uint256 overflow",
			input: tesseraInput(NetworkBase, resolved.SideBuy, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", resolved.DecimalString(new(big.Int).Add(maxUint256, big.NewInt(1)).String()), "1"),
			want:  "invalid request: tessera srcAmount exceeds uint256 maximum",
		},
		{
			name:  "invalid src address",
			input: tesseraInput(NetworkBase, resolved.SideSell, "0x1234", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "90"),
			want:  "invalid request: tessera srcToken is not a valid address",
		},
		{
			name:  "invalid dest address",
			input: tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x1234", "100", "90"),
			want:  "invalid request: tessera destToken is not a valid address",
		},
		{
			name: "invalid recipient address",
			input: func() builder.DexParamInput {
				input := tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "90")
				input.Recipient = "0x1234"
				return input
			}(),
			want: "invalid request: tessera recipient is not a valid address",
		},
		{
			name:  "invalid router address",
			input: tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "90"),
			config: func() Config {
				config := DefaultConfig()
				config.RouterByNetwork[NetworkBase] = "0x1234"
				return config
			}(),
			want: "invalid request: tessera router is not a valid address",
		},
		{
			name:  "invalid wrapped-native address",
			input: tesseraInput(NetworkBase, resolved.SideSell, resolved.NativeTokenAddress, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "90"),
			config: func() Config {
				config := DefaultConfig()
				config.WrappedNativeByNetwork[NetworkBase] = "0x1234"
				return config
			}(),
			want: "invalid request: tessera wrappedNativeToken is not a valid address",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testEncoder := encoder
			if tt.config.RouterByNetwork != nil || tt.config.WrappedNativeByNetwork != nil {
				testEncoder = New(tt.config)
			}
			_, err := testEncoder.GetDexParam(context.Background(), tt.input)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
		})
	}
}

func TestTesseraAcceptsZeroSellAmount(t *testing.T) {
	input := tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0", "90")
	decoded := mustDecodeTesseraCall(t, mustGetDexParam(t, New(DefaultConfig()), input).ExchangeData)
	if decoded.AmountSpecified != "0" || decoded.AmountCheck != "0" {
		t.Fatalf("amount mismatch: got specified=%s check=%s", decoded.AmountSpecified, decoded.AmountCheck)
	}
}

func TestTesseraAcceptsMaxInt256SellAmount(t *testing.T) {
	input := tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", resolved.DecimalString(maxInt256.String()), "90")
	decoded := mustDecodeTesseraCall(t, mustGetDexParam(t, New(DefaultConfig()), input).ExchangeData)
	if decoded.AmountSpecified != maxInt256.String() {
		t.Fatalf("amount mismatch: got %s want %s", decoded.AmountSpecified, maxInt256.String())
	}
}

func TestTesseraDeterministicOutput(t *testing.T) {
	encoder := New(DefaultConfig())
	input := tesseraInput(NetworkBase, resolved.SideSell, baseWETH, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "100", "90")
	first := mustGetDexParam(t, encoder, input)
	second := mustGetDexParam(t, encoder, input)
	if first.ExchangeData != second.ExchangeData {
		t.Fatalf("exchangeData is not deterministic: %s != %s", first.ExchangeData, second.ExchangeData)
	}
}

type decodedTesseraCall struct {
	TokenIn         string
	TokenOut        string
	AmountSpecified string
	AmountCheck     string
	Recipient       string
	SwapData        []byte
}

func mustGetDexParam(t *testing.T, encoder *Encoder, input builder.DexParamInput) builder.DexExchangeParam {
	t.Helper()
	param, err := encoder.GetDexParam(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	return param
}

func mustDecodeTesseraCall(t *testing.T, calldata resolved.HexBytes) decodedTesseraCall {
	t.Helper()
	decoded, err := decodeTesseraCall(calldata)
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

func decodeTesseraCall(calldata resolved.HexBytes) (decodedTesseraCall, error) {
	raw := strings.TrimPrefix(string(calldata), "0x")
	if len(raw) < 8 {
		return decodedTesseraCall{}, fmt.Errorf("calldata shorter than selector")
	}
	parsed, err := loadTesseraSwapABICached()
	if err != nil {
		return decodedTesseraCall{}, err
	}
	method := parsed.Methods[swapMethodName]
	if raw[:8] != fmt.Sprintf("%x", method.ID) {
		return decodedTesseraCall{}, fmt.Errorf("selector mismatch: got 0x%s want 0x%x", raw[:8], method.ID)
	}
	callBytes, err := hex.DecodeString(raw[8:])
	if err != nil {
		return decodedTesseraCall{}, err
	}
	values, err := method.Inputs.Unpack(callBytes)
	if err != nil {
		return decodedTesseraCall{}, err
	}
	if len(values) != 6 {
		return decodedTesseraCall{}, fmt.Errorf("expected 6 inputs, got %d", len(values))
	}
	return decodedTesseraCall{
		TokenIn:         strings.ToLower(values[0].(common.Address).Hex()),
		TokenOut:        strings.ToLower(values[1].(common.Address).Hex()),
		AmountSpecified: values[2].(*big.Int).String(),
		AmountCheck:     values[3].(*big.Int).String(),
		Recipient:       strings.ToLower(values[4].(common.Address).Hex()),
		SwapData:        append([]byte(nil), values[5].([]byte)...),
	}, nil
}

func tesseraCalldataDiff(name string, got resolved.HexBytes, expected resolved.HexBytes) string {
	gotDecoded, gotErr := decodeTesseraCall(got)
	expectedDecoded, expectedErr := decodeTesseraCall(expected)
	if gotErr != nil || expectedErr != nil {
		return fmt.Sprintf("%s decode error: got=%v want=%v", name, gotErr, expectedErr)
	}
	return fmt.Sprintf("%s decoded Tessera calldata\n got: %+v\nwant: %+v", name, gotDecoded, expectedDecoded)
}

func tesseraInput(
	network int,
	side resolved.Side,
	srcToken resolved.Address,
	destToken resolved.Address,
	srcAmount resolved.DecimalString,
	destAmount resolved.DecimalString,
) builder.DexParamInput {
	// Tessera reads route.network, side, src/dest token, src/dest amount, and
	// recipient. The remaining route-position fields are stable placeholders
	// that keep test inputs shaped like public-builder DEX calls.
	rawNull := json.RawMessage("null")
	needWrapInput := builder.NeedWrapNativeInput{
		Route: builder.NeedWrapNativeRouteContext{
			Network:      network,
			Side:         side,
			RouteIndex:   0,
			RoutePercent: 100,
			BlockNumber:  1,
			SrcToken:     srcToken,
			DestToken:    destToken,
			SrcAmount:    srcAmount,
			DestAmount:   destAmount,
		},
		Swap: builder.NeedWrapNativeSwapContext{
			SwapIndex:  0,
			SrcToken:   srcToken,
			DestToken:  destToken,
			SrcAmount:  srcAmount,
			DestAmount: destAmount,
		},
		SwapExchange: builder.NeedWrapNativeSwapExchangeContext{
			SwapExchangeIndex: 0,
			Exchange:          "tessera",
			Percent:           100,
			SrcAmount:         srcAmount,
			DestAmount:        destAmount,
			Data:              rawNull,
		},
	}
	return builder.DexParamInput{
		NeedWrapNativeInput: needWrapInput,
		DexKey:              "tessera",
		SrcToken:            srcToken,
		DestToken:           destToken,
		SrcAmount:           srcAmount,
		DestAmount:          destAmount,
		Recipient:           "0x1111111111111111111111111111111111111111",
		ExecutorAddress:     "0x2222222222222222222222222222222222222222",
		Side:                side,
		Data:                rawNull,
	}
}
