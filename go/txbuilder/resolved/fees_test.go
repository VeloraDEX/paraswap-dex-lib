package resolved_test

import (
	"encoding/json"
	"math/big"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildFeesV6MatchesFixturePartnerAndFee(t *testing.T) {
	for _, fixtureName := range []string{
		"executor01-simple-sell-approved",
		"fee-nonzero-partner",
		"fee-referrer",
		"fee-take-surplus",
		"fee-surplus-to-user",
		"fee-direct-transfer",
	} {
		t.Run(fixtureName, func(t *testing.T) {
			input, expectedParams := loadBuildInputWithExpectedParams(t, fixtureName)
			fee, err := resolved.ParseFeeInput(input)
			if err != nil {
				t.Fatal(err)
			}

			got, err := resolved.BuildFeesV6(fee)
			if err != nil {
				t.Fatal(err)
			}

			want := expectedParams[2].(string)
			if got.String() != want {
				t.Fatalf("partnerAndFee mismatch:\n got: %s\nwant: %s", got.String(), want)
			}
		})
	}
}

func TestBuildFeesV6SkipBlacklistMask(t *testing.T) {
	got, err := resolved.BuildFeesV6(resolved.FeeInput{
		PartnerAddress:    resolved.NullAddress,
		PartnerFeePercent: "0",
		IsSkipBlacklist:   true,
	})
	if err != nil {
		t.Fatal(err)
	}

	want := new(big.Int).Lsh(big.NewInt(1), 93).String()
	if got.String() != want {
		t.Fatalf("skip blacklist mask mismatch: got %s want %s", got.String(), want)
	}
}

func TestBuildFeesV6UsesFeePercentMask(t *testing.T) {
	got, err := resolved.BuildFeesV6(resolved.FeeInput{
		PartnerAddress:    resolved.NullAddress,
		PartnerFeePercent: "65535",
	})
	if err != nil {
		t.Fatal(err)
	}

	want := new(big.Int).SetInt64(0x3fff).String()
	if got.String() != want {
		t.Fatalf("fee percent mask mismatch: got %s want %s", got.String(), want)
	}
}

func TestBuildFeesV6RejectsNegativeFeePercentBitwiseResult(t *testing.T) {
	_, err := resolved.BuildFeesV6(resolved.FeeInput{
		PartnerAddress:    resolved.NullAddress,
		PartnerFeePercent: "-5",
	})
	if err == nil {
		t.Fatal("expected negative feePercent bitwise error")
	}
}

func TestParseFeeInputRejectsMalformedJSON(t *testing.T) {
	_, err := resolved.ParseFeeInput(resolved.BuildInput{Fee: json.RawMessage(`{"partnerAddress":`)})
	if err == nil {
		t.Fatal("expected malformed fee error")
	}
}
