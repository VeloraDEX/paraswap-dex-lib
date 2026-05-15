package resolved

import (
	"encoding/json"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
)

type Address string
type HexBytes string
type DecimalString string
type ExecutorType string
type Side string

const (
	Executor01   ExecutorType = "Executor01"
	Executor02   ExecutorType = "Executor02"
	Executor03   ExecutorType = "Executor03"
	ExecutorWETH ExecutorType = "WETH"
)

const (
	SideSell Side = "SELL"
	SideBuy  Side = "BUY"
)

type EncodingContext struct {
	Network                   int
	AugustusV6Address         Address
	WrappedNativeTokenAddress Address
	ExecutorsAddresses        map[ExecutorType]Address
}

type BuildDeps struct {
	EncodingContext EncodingContext
	AugustusV6ABI   *ethabi.ABI
}

type BuildInput struct {
	RoutePlan                 json.RawMessage   `json:"routePlan"`
	ResolvedLegs              []json.RawMessage `json:"resolvedLegs"`
	WethPlan                  *json.RawMessage  `json:"wethPlan,omitempty"`
	ExecutorType              ExecutorType      `json:"executorType"`
	ExecutorAddress           Address           `json:"executorAddress"`
	AugustusV6Address         Address           `json:"augustusV6Address"`
	WrappedNativeTokenAddress Address           `json:"wrappedNativeTokenAddress"`
	Network                   int               `json:"network"`
	SrcToken                  Address           `json:"srcToken"`
	DestToken                 Address           `json:"destToken"`
	SrcAmount                 DecimalString     `json:"srcAmount"`
	DestAmount                DecimalString     `json:"destAmount"`
	MinMaxAmount              DecimalString     `json:"minMaxAmount"`
	QuotedAmount              DecimalString     `json:"quotedAmount"`
	Side                      Side              `json:"side"`
	ContractMethod            string            `json:"contractMethod"`
	BlockNumber               int64             `json:"blockNumber"`
	UserAddress               Address           `json:"userAddress"`
	Beneficiary               Address           `json:"beneficiary"`
	Permit                    HexBytes          `json:"permit"`
	UUID                      string            `json:"uuid"`
	Fee                       json.RawMessage   `json:"fee"`
	Gas                       *GasInput         `json:"gas,omitempty"`
}

type DirectBuildInput struct {
	ContractMethod    string            `json:"contractMethod"`
	Params            []json.RawMessage `json:"params"`
	UserAddress       Address           `json:"userAddress"`
	AugustusV6Address Address           `json:"augustusV6Address"`
	SrcToken          Address           `json:"srcToken"`
	SrcAmount         DecimalString     `json:"srcAmount"`
	MinMaxAmount      DecimalString     `json:"minMaxAmount"`
	Side              Side              `json:"side"`
	Gas               *GasInput         `json:"gas,omitempty"`
}

type GasInput struct {
	GasPrice             DecimalString `json:"gasPrice,omitempty"`
	MaxFeePerGas         DecimalString `json:"maxFeePerGas,omitempty"`
	MaxPriorityFeePerGas DecimalString `json:"maxPriorityFeePerGas,omitempty"`
}

type TxObject struct {
	From                 Address       `json:"from"`
	To                   Address       `json:"to"`
	Value                DecimalString `json:"value"`
	Data                 HexBytes      `json:"data"`
	GasPrice             DecimalString `json:"gasPrice,omitempty"`
	MaxFeePerGas         DecimalString `json:"maxFeePerGas,omitempty"`
	MaxPriorityFeePerGas DecimalString `json:"maxPriorityFeePerGas,omitempty"`
}

type BuildOutput struct {
	Params []any
	Tx     TxObject
}
