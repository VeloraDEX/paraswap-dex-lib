package executor

import (
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildApproveCallDataAppendsBalanceMarkerBeforeWrap(t *testing.T) {
	context := resolved.EncodingContext{Network: 1}
	spender := resolved.Address("0x2222222222222222222222222222222222222222")
	token := resolved.Address("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")

	got, err := buildApproveCallData(
		context,
		spender,
		token,
		insertFromAmountCheckSrcTokenBalanceAfterSwap,
		false,
		maxUint,
	)
	if err != nil {
		t.Fatal(err)
	}

	rawApprove, err := buildERC20ApproveCalldata(spender, maxUint)
	if err != nil {
		t.Fatal(err)
	}
	rawApproveWithMarker, err := concatHex(string(rawApprove), zeroBytes(12), string(token))
	if err != nil {
		t.Fatal(err)
	}
	want, err := buildExecutor0102CallData(
		token,
		rawApproveWithMarker,
		0,
		approveCalldataDestTokenPos,
		specialDexDefault,
		insertFromAmountCheckSrcTokenBalanceAfterSwap,
		defaultReturnAmountPos,
	)
	if err != nil {
		t.Fatal(err)
	}

	if got != want {
		t.Fatalf("approval calldata mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func TestBuildPermit2CallDataAppendsBalanceMarkerAfterWrappedPermit2Call(t *testing.T) {
	context := resolved.EncodingContext{Network: 1}
	spender := resolved.Address("0x2222222222222222222222222222222222222222")
	token := resolved.Address("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")

	got, err := buildPermit2CallData(
		context,
		spender,
		token,
		insertFromAmountCheckSrcTokenBalanceAfterSwap,
	)
	if err != nil {
		t.Fatal(err)
	}

	permit2Data, err := buildPermit2ApproveCalldata(token, spender, maxUint160, maxUint48)
	if err != nil {
		t.Fatal(err)
	}
	wrappedPermit2Data, err := buildExecutor0102CallData(
		resolved.Address(permit2Address),
		permit2Data,
		0,
		approveCalldataDestTokenPos,
		specialDexDefault,
		insertFromAmountCheckSrcTokenBalanceAfterSwap,
		defaultReturnAmountPos,
	)
	if err != nil {
		t.Fatal(err)
	}
	wantSuffix, err := concatHex(string(wrappedPermit2Data), zeroBytes(12), string(token))
	if err != nil {
		t.Fatal(err)
	}

	if !strings.HasSuffix(string(got), strings.TrimPrefix(string(wantSuffix), "0x")) {
		t.Fatalf("permit2 marker suffix mismatch:\n got: %s\nwant suffix: %s", got, wantSuffix)
	}
}

func TestBuildApproveCallDataDisabledTokenPrependsResetApproval(t *testing.T) {
	context := resolved.EncodingContext{Network: 1}
	spender := resolved.Address("0x2222222222222222222222222222222222222222")
	token := resolved.Address("0xdac17f958d2ee523a2206206994597c13d831ec7")

	got, err := buildApproveCallData(
		context,
		spender,
		token,
		dontInsertFromAmountDontCheckBalanceAfterSwap,
		false,
		maxUint,
	)
	if err != nil {
		t.Fatal(err)
	}

	resetApprove, err := buildERC20ApproveCalldata(spender, "0")
	if err != nil {
		t.Fatal(err)
	}
	maxApprove, err := buildERC20ApproveCalldata(spender, maxUint)
	if err != nil {
		t.Fatal(err)
	}
	resetIndex := strings.Index(string(got), strings.TrimPrefix(string(resetApprove), "0x"))
	maxIndex := strings.Index(string(got), strings.TrimPrefix(string(maxApprove), "0x"))
	if resetIndex == -1 || maxIndex == -1 || resetIndex >= maxIndex {
		t.Fatalf("disabled-token reset approval order mismatch:\n got: %s", got)
	}
}

func TestBuildPermit2CallDataDisabledTokenPrependsResetApproval(t *testing.T) {
	context := resolved.EncodingContext{Network: 1}
	spender := resolved.Address("0x2222222222222222222222222222222222222222")
	token := resolved.Address("0xdac17f958d2ee523a2206206994597c13d831ec7")

	got, err := buildPermit2CallData(
		context,
		spender,
		token,
		dontInsertFromAmountDontCheckBalanceAfterSwap,
	)
	if err != nil {
		t.Fatal(err)
	}

	resetApprove, err := buildERC20ApproveCalldata(resolved.Address(permit2Address), "0")
	if err != nil {
		t.Fatal(err)
	}
	maxApprove, err := buildERC20ApproveCalldata(resolved.Address(permit2Address), maxUint)
	if err != nil {
		t.Fatal(err)
	}
	permit2Approve, err := buildPermit2ApproveCalldata(token, spender, maxUint160, maxUint48)
	if err != nil {
		t.Fatal(err)
	}

	resetIndex := strings.Index(string(got), strings.TrimPrefix(string(resetApprove), "0x"))
	maxIndex := strings.Index(string(got), strings.TrimPrefix(string(maxApprove), "0x"))
	permit2Index := strings.Index(string(got), strings.TrimPrefix(string(permit2Approve), "0x"))
	if resetIndex == -1 || maxIndex == -1 || permit2Index == -1 {
		t.Fatalf("disabled-token permit2 approval sequence missing expected calls:\n got: %s", got)
	}
	if resetIndex >= maxIndex || maxIndex >= permit2Index {
		t.Fatalf("disabled-token permit2 approval order mismatch:\n got: %s", got)
	}
}
