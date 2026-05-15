package resolved

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"reflect"
	"strings"

	ethabi "github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

func ParseDirectParamsForOutput(params json.RawMessage) ([]any, error) {
	trimmed := bytes.TrimSpace(params)
	if len(trimmed) == 0 || !bytes.HasPrefix(trimmed, []byte("[")) {
		return nil, fmt.Errorf("direct params must be an array")
	}
	var output []any
	if err := json.Unmarshal(trimmed, &output); err != nil {
		return nil, fmt.Errorf("parse direct params: %w", err)
	}
	return output, nil
}

func encodeDirectCalldata(
	input DirectBuildInput,
	params []json.RawMessage,
	augustusV6ABI *ethabi.ABI,
) (HexBytes, error) {
	if augustusV6ABI == nil {
		return "", fmt.Errorf("Augustus V6 ABI is required")
	}

	method, ok := augustusV6ABI.Methods[input.ContractMethod]
	if !ok {
		return "", fmt.Errorf("Augustus V6 method not found: %s", input.ContractMethod)
	}

	coerced, err := CoerceDirectParamsForABI(input.ContractMethod, params, method)
	if err != nil {
		return "", err
	}

	packed, err := method.Inputs.Pack(coerced...)
	if err != nil {
		return "", fmt.Errorf("encode %s calldata: %w", input.ContractMethod, err)
	}

	calldata := make([]byte, 0, len(method.ID)+len(packed))
	calldata = append(calldata, method.ID...)
	calldata = append(calldata, packed...)

	return HexBytes("0x" + hex.EncodeToString(calldata)), nil
}

func CoerceDirectParamsForABI(
	contractMethod string,
	params []json.RawMessage,
	method ethabi.Method,
) ([]any, error) {
	if err := validateSupportedDirectContractMethod(contractMethod); err != nil {
		return nil, err
	}
	if len(params) != len(method.Inputs) {
		return nil, fmt.Errorf(
			"%s params length mismatch: got %d want %d",
			contractMethod,
			len(params),
			len(method.Inputs),
		)
	}

	out := make([]any, 0, len(params))
	for index, input := range method.Inputs {
		value, err := coerceJSONToABIType(params[index], input.Type, input.Name)
		if err != nil {
			return nil, fmt.Errorf("%s param %d (%s): %w", contractMethod, index, input.Name, err)
		}
		out = append(out, value.Interface())
	}
	return out, nil
}

func coerceJSONToABIType(raw json.RawMessage, typ ethabi.Type, path string) (reflect.Value, error) {
	switch typ.T {
	case ethabi.TupleTy:
		return coerceJSONTuple(raw, typ, path)
	case ethabi.SliceTy:
		return coerceJSONSlice(raw, typ, path)
	case ethabi.ArrayTy:
		return coerceJSONArray(raw, typ, path)
	case ethabi.AddressTy:
		value, err := rawJSONString(raw, path)
		if err != nil {
			return reflect.Value{}, err
		}
		if !common.IsHexAddress(value) {
			return reflect.Value{}, fmt.Errorf("%s must be a 0x-prefixed 20-byte hex address: %s", path, value)
		}
		return reflect.ValueOf(common.HexToAddress(value)), nil
	case ethabi.BytesTy:
		value, err := rawJSONString(raw, path)
		if err != nil {
			return reflect.Value{}, err
		}
		decoded, err := decodeHexBytes(HexBytes(value), path)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(decoded), nil
	case ethabi.FixedBytesTy:
		return coerceJSONFixedBytes(raw, typ, path)
	case ethabi.UintTy:
		return coerceJSONUint(raw, typ, path)
	case ethabi.IntTy:
		return coerceJSONInt(raw, typ, path)
	case ethabi.BoolTy:
		var value bool
		if err := json.Unmarshal(raw, &value); err != nil {
			return reflect.Value{}, fmt.Errorf("%s must be boolean", path)
		}
		return reflect.ValueOf(value), nil
	case ethabi.StringTy:
		value, err := rawJSONString(raw, path)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(value), nil
	default:
		return reflect.Value{}, fmt.Errorf("unsupported ABI type %s", typ.String())
	}
}

func coerceJSONTuple(raw json.RawMessage, typ ethabi.Type, path string) (reflect.Value, error) {
	fields, err := rawJSONArray(raw, path)
	if err != nil {
		return reflect.Value{}, err
	}
	if len(fields) != len(typ.TupleElems) {
		return reflect.Value{}, fmt.Errorf("%s tuple length mismatch: got %d want %d", path, len(fields), len(typ.TupleElems))
	}

	out := reflect.New(typ.GetType()).Elem()
	for index, elemType := range typ.TupleElems {
		fieldName := typ.TupleRawNames[index]
		if fieldName == "" {
			fieldName = fmt.Sprintf("%d", index)
		}
		value, err := coerceJSONToABIType(fields[index], *elemType, path+"."+fieldName)
		if err != nil {
			return reflect.Value{}, err
		}
		out.Field(index).Set(value)
	}
	return out, nil
}

func coerceJSONSlice(raw json.RawMessage, typ ethabi.Type, path string) (reflect.Value, error) {
	items, err := rawJSONArray(raw, path)
	if err != nil {
		return reflect.Value{}, err
	}
	out := reflect.MakeSlice(typ.GetType(), len(items), len(items))
	for index, item := range items {
		value, err := coerceJSONToABIType(item, *typ.Elem, fmt.Sprintf("%s[%d]", path, index))
		if err != nil {
			return reflect.Value{}, err
		}
		out.Index(index).Set(value)
	}
	return out, nil
}

func coerceJSONArray(raw json.RawMessage, typ ethabi.Type, path string) (reflect.Value, error) {
	items, err := rawJSONArray(raw, path)
	if err != nil {
		return reflect.Value{}, err
	}
	if len(items) != typ.Size {
		return reflect.Value{}, fmt.Errorf("%s array length mismatch: got %d want %d", path, len(items), typ.Size)
	}
	out := reflect.New(typ.GetType()).Elem()
	for index, item := range items {
		value, err := coerceJSONToABIType(item, *typ.Elem, fmt.Sprintf("%s[%d]", path, index))
		if err != nil {
			return reflect.Value{}, err
		}
		out.Index(index).Set(value)
	}
	return out, nil
}

func coerceJSONFixedBytes(raw json.RawMessage, typ ethabi.Type, path string) (reflect.Value, error) {
	value, err := rawJSONString(raw, path)
	if err != nil {
		return reflect.Value{}, err
	}
	decoded, err := decodeHexBytes(HexBytes(value), path)
	if err != nil {
		return reflect.Value{}, err
	}
	if len(decoded) != typ.Size {
		return reflect.Value{}, fmt.Errorf("%s must be %d bytes, got %d", path, typ.Size, len(decoded))
	}
	out := reflect.New(typ.GetType()).Elem()
	for index, item := range decoded {
		out.Index(index).SetUint(uint64(item))
	}
	return out, nil
}

func coerceJSONUint(raw json.RawMessage, typ ethabi.Type, path string) (reflect.Value, error) {
	value, err := parseBigIntString(raw, path)
	if err != nil {
		return reflect.Value{}, err
	}
	if value.Sign() < 0 {
		return reflect.Value{}, fmt.Errorf("%s must be a non-negative decimal integer", path)
	}
	if value.BitLen() > typ.Size {
		return reflect.Value{}, fmt.Errorf("%s exceeds uint%d", path, typ.Size)
	}

	targetType := typ.GetType()
	if targetType.Kind() == reflect.Ptr {
		return reflect.ValueOf(value), nil
	}
	out := reflect.New(targetType).Elem()
	out.SetUint(value.Uint64())
	return out, nil
}

func coerceJSONInt(raw json.RawMessage, typ ethabi.Type, path string) (reflect.Value, error) {
	value, err := parseBigIntString(raw, path)
	if err != nil {
		return reflect.Value{}, err
	}

	limit := new(big.Int).Lsh(big.NewInt(1), uint(typ.Size-1))
	min := new(big.Int).Neg(limit)
	max := new(big.Int).Sub(limit, big.NewInt(1))
	if value.Cmp(min) < 0 || value.Cmp(max) > 0 {
		return reflect.Value{}, fmt.Errorf("%s exceeds int%d", path, typ.Size)
	}

	targetType := typ.GetType()
	if targetType.Kind() == reflect.Ptr {
		return reflect.ValueOf(value), nil
	}
	out := reflect.New(targetType).Elem()
	out.SetInt(value.Int64())
	return out, nil
}

func rawJSONArray(raw json.RawMessage, path string) ([]json.RawMessage, error) {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("%s must be an array", path)
	}
	return items, nil
}

func rawJSONString(raw json.RawMessage, path string) (string, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", fmt.Errorf("%s must be a string", path)
	}
	return value, nil
}

func parseBigIntString(raw json.RawMessage, path string) (*big.Int, error) {
	value, err := rawJSONString(raw, path)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(value, "+") {
		return nil, fmt.Errorf("%s must be a decimal integer", path)
	}
	out, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return nil, fmt.Errorf("%s must be a decimal integer", path)
	}
	return out, nil
}
