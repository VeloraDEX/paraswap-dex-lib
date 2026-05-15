package tessera

import (
	"context"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"sync"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

const swapMethodName = "tesseraSwapWithAllowances"

var (
	maxInt256  = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(1))
	maxUint256 = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
)

// Encoder is immutable after construction and safe for concurrent use.
type Encoder struct {
	config Config
}

var _ builder.DexEncoder = (*Encoder)(nil)

// New returns an immutable Tessera encoder. Encoder methods are safe for
// concurrent use after construction.
func New(config Config) *Encoder {
	return &Encoder{config: normalizeConfig(config)}
}

func (e *Encoder) NeedWrapNative(context.Context, builder.NeedWrapNativeInput) (bool, error) {
	// Tessera is static-true in the TypeScript builder. Network support is
	// checked in GetDexParam because public route call-param resolution runs
	// after the needWrapNative decision.
	return true, nil
}

func (e *Encoder) GetDexParam(_ context.Context, input builder.DexParamInput) (builder.DexExchangeParam, error) {
	network := input.Route.Network
	router, wrappedNative, err := e.networkConfig(network)
	if err != nil {
		return builder.DexExchangeParam{}, err
	}
	if err := validateAddress("router", router); err != nil {
		return builder.DexExchangeParam{}, err
	}
	if err := validateAddress("wrappedNativeToken", wrappedNative); err != nil {
		return builder.DexExchangeParam{}, err
	}
	if err := validateAddress("srcToken", input.SrcToken); err != nil {
		return builder.DexExchangeParam{}, err
	}
	if err := validateAddress("destToken", input.DestToken); err != nil {
		return builder.DexExchangeParam{}, err
	}
	if err := validateAddress("recipient", input.Recipient); err != nil {
		return builder.DexExchangeParam{}, err
	}

	tokenIn := wrapNative(input.SrcToken, wrappedNative)
	tokenOut := wrapNative(input.DestToken, wrappedNative)
	amountSpecified, amountCheck, err := buildAmounts(input)
	if err != nil {
		return builder.DexExchangeParam{}, err
	}

	exchangeData, err := packSwapCall(tokenIn, tokenOut, amountSpecified, amountCheck, normalizeAddress(input.Recipient))
	if err != nil {
		return builder.DexExchangeParam{}, err
	}

	return builder.DexExchangeParam{
		NeedWrapNative:      true,
		ExchangeData:        exchangeData,
		TargetExchange:      normalizeAddress(router),
		DexFuncHasRecipient: true,
	}, nil
}

func (e *Encoder) networkConfig(network int) (resolved.Address, resolved.Address, error) {
	router, ok := e.config.RouterByNetwork[network]
	if !ok || router == "" {
		return "", "", fmt.Errorf("tessera: unsupported chain %d", network)
	}
	wrappedNative, ok := e.config.WrappedNativeByNetwork[network]
	if !ok || wrappedNative == "" {
		return "", "", fmt.Errorf("tessera: unsupported chain %d", network)
	}
	return router, wrappedNative, nil
}

func buildAmounts(input builder.DexParamInput) (*big.Int, *big.Int, error) {
	switch input.Side {
	case resolved.SideSell:
		srcAmount, err := parseAmount(input.SrcAmount, "srcAmount")
		if err != nil {
			return nil, nil, err
		}
		if srcAmount.Sign() < 0 {
			return nil, nil, fmt.Errorf("invalid request: tessera srcAmount must be non-negative")
		}
		if srcAmount.Cmp(maxInt256) > 0 {
			return nil, nil, fmt.Errorf("invalid request: tessera srcAmount exceeds int256 maximum")
		}
		return srcAmount, big.NewInt(0), nil
	case resolved.SideBuy:
		destAmount, err := parseAmount(input.DestAmount, "destAmount")
		if err != nil {
			return nil, nil, err
		}
		if destAmount.Sign() <= 0 {
			return nil, nil, fmt.Errorf("invalid request: tessera destAmount must be positive")
		}
		if destAmount.Cmp(maxInt256) > 0 {
			return nil, nil, fmt.Errorf("invalid request: tessera destAmount exceeds int256 maximum")
		}
		srcAmount, err := parseAmount(input.SrcAmount, "srcAmount")
		if err != nil {
			return nil, nil, err
		}
		if srcAmount.Sign() < 0 {
			return nil, nil, fmt.Errorf("invalid request: tessera srcAmount must be non-negative")
		}
		if srcAmount.Cmp(maxUint256) > 0 {
			return nil, nil, fmt.Errorf("invalid request: tessera srcAmount exceeds uint256 maximum")
		}
		return new(big.Int).Neg(destAmount), srcAmount, nil
	default:
		return nil, nil, fmt.Errorf("invalid request: tessera unsupported swap side %q", input.Side)
	}
}

func packSwapCall(
	tokenIn resolved.Address,
	tokenOut resolved.Address,
	amountSpecified *big.Int,
	amountCheck *big.Int,
	recipient resolved.Address,
) (resolved.HexBytes, error) {
	parsed, err := loadTesseraSwapABICached()
	if err != nil {
		return "", err
	}
	method, ok := parsed.Methods[swapMethodName]
	if !ok {
		return "", fmt.Errorf("Tessera swap method not found: %s", swapMethodName)
	}
	packed, err := method.Inputs.Pack(
		common.HexToAddress(string(tokenIn)),
		common.HexToAddress(string(tokenOut)),
		amountSpecified,
		amountCheck,
		common.HexToAddress(string(recipient)),
		[]byte{},
	)
	if err != nil {
		return "", fmt.Errorf("encode Tessera swap calldata: %w", err)
	}
	calldata := make([]byte, 0, len(method.ID)+len(packed))
	calldata = append(calldata, method.ID...)
	calldata = append(calldata, packed...)
	return resolved.HexBytes("0x" + hex.EncodeToString(calldata)), nil
}

func parseAmount(value resolved.DecimalString, field string) (*big.Int, error) {
	out, ok := new(big.Int).SetString(string(value), 10)
	if !ok {
		return nil, fmt.Errorf("invalid request: tessera %s must be decimal", field)
	}
	return out, nil
}

func validateAddress(field string, address resolved.Address) error {
	if !common.IsHexAddress(string(address)) {
		return fmt.Errorf("invalid request: tessera %s is not a valid address", field)
	}
	return nil
}

func wrapNative(address resolved.Address, wrappedNative resolved.Address) resolved.Address {
	normalized := normalizeAddress(address)
	if normalized == resolved.NativeTokenAddress || normalized == resolved.NullAddress {
		return normalizeAddress(wrappedNative)
	}
	return normalized
}

func normalizeAddress(address resolved.Address) resolved.Address {
	return resolved.Address(strings.ToLower(string(address)))
}

var (
	abiOnce   sync.Once
	abiCached *ethabi.ABI
	abiErr    error
)

func loadTesseraSwapABICached() (*ethabi.ABI, error) {
	abiOnce.Do(func() {
		abiCached, abiErr = LoadTesseraSwapABI()
	})
	// The cached ABI is package-internal and treated as immutable. Callers must
	// not mutate Methods or input definitions on the returned pointer.
	return abiCached, abiErr
}
