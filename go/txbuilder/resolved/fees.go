package resolved

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
)

type feePackParams struct {
	partner             Address
	feePercent          DecimalString
	isTakeSurplus       bool
	isCapSurplus        bool
	isSurplusToUser     bool
	isDirectFeeTransfer bool
	isReferral          bool
	isSkipBlacklist     bool
}

func ParseFeeInput(input BuildInput) (FeeInput, error) {
	var fee *FeeInput
	if len(input.Fee) == 0 {
		return FeeInput{}, fmt.Errorf("fee is required")
	}
	if err := json.Unmarshal(input.Fee, &fee); err != nil {
		return FeeInput{}, fmt.Errorf("parse fee: %w", err)
	}
	if fee == nil {
		return FeeInput{}, fmt.Errorf("fee is required")
	}
	return *fee, nil
}

func BuildFeesV6(fee FeeInput) (*big.Int, error) {
	if fee.ReferrerAddress != nil {
		return packPartnerAndFeeData(feePackParams{
			partner:             *fee.ReferrerAddress,
			feePercent:          "0",
			isTakeSurplus:       fee.TakeSurplus,
			isCapSurplus:        fee.IsCapSurplus,
			isSurplusToUser:     fee.IsSurplusToUser,
			isDirectFeeTransfer: fee.IsDirectFeeTransfer,
			isReferral:          true,
			isSkipBlacklist:     fee.IsSkipBlacklist,
		})
	}

	return packPartnerAndFeeData(feePackParams{
		partner:             fee.PartnerAddress,
		feePercent:          fee.PartnerFeePercent,
		isTakeSurplus:       fee.TakeSurplus,
		isCapSurplus:        fee.IsCapSurplus,
		isSurplusToUser:     fee.IsSurplusToUser,
		isDirectFeeTransfer: fee.IsDirectFeeTransfer,
		isReferral:          false,
		isSkipBlacklist:     fee.IsSkipBlacklist,
	})
}

func packPartnerAndFeeData(params feePackParams) (*big.Int, error) {
	feePercent, err := parseDecimalBigInt(params.feePercent, "feePercent")
	if err != nil {
		return nil, err
	}

	partner := params.partner
	if feePercent.Sign() == 0 && !params.isTakeSurplus && !params.isReferral {
		partner = NullAddress
	}

	partnerAddress, err := parseAddressBigInt(partner, "partner")
	if err != nil {
		return nil, err
	}

	partnerBits := new(big.Int).Lsh(partnerAddress, 96)
	flagBits := new(big.Int)

	if feePercent.Sign() != 0 {
		if feePercent.Sign() < 0 {
			return nil, fmt.Errorf("feePercent bitwise operation requires non-negative value: %s", params.feePercent)
		}
		flagBits.And(feePercent, feePercentBasisPointsMask())
	} else {
		if params.isTakeSurplus {
			flagBits.Or(flagBits, oneShifted(95))
		} else if params.isReferral {
			flagBits.Or(flagBits, oneShifted(94))
		}
	}

	if params.isSkipBlacklist {
		flagBits.Or(flagBits, oneShifted(93))
	}
	if params.isCapSurplus {
		flagBits.Or(flagBits, oneShifted(92))
	}
	if params.isDirectFeeTransfer {
		flagBits.Or(flagBits, oneShifted(91))
	}
	if params.isSurplusToUser {
		flagBits.Or(flagBits, oneShifted(90))
	}

	return partnerBits.Or(partnerBits, flagBits), nil
}

func parseDecimalBigInt(value DecimalString, field string) (*big.Int, error) {
	out, ok := new(big.Int).SetString(string(value), 10)
	if !ok {
		return nil, fmt.Errorf("%s must be a decimal integer: %s", field, value)
	}
	return out, nil
}

func parseAddressBigInt(value Address, field string) (*big.Int, error) {
	// Address casing is validated by the resolved boundary before fee packing.
	raw := strings.TrimPrefix(string(value), "0x")
	if len(raw) != 40 {
		return nil, fmt.Errorf("%s must be a 20-byte hex address: %s", field, value)
	}
	out, ok := new(big.Int).SetString(raw, 16)
	if !ok {
		return nil, fmt.Errorf("%s must be a hex address: %s", field, value)
	}
	return out, nil
}

func feePercentBasisPointsMask() *big.Int {
	return big.NewInt(0x3fff)
}

func oneShifted(bits uint) *big.Int {
	return new(big.Int).Lsh(big.NewInt(1), bits)
}
