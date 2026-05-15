package builder_test

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/executor"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/publicbuildertest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/resolvedtest"
	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

func TestBuildGenericPublicFixtures(t *testing.T) {
	collection, err := publicbuildertest.LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range collection.Fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			req, err := publicbuildertest.DecodeBuildRequest(fixture)
			if err != nil {
				t.Fatal(err)
			}
			expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
			if err != nil {
				t.Fatal(err)
			}

			inputDeps := buildDeps(t, fixture, expectedInput)
			gotInput, err := builder.BuildGenericInputForTest(context.Background(), req, inputDeps)
			if err != nil {
				t.Fatal(err)
			}
			assertJSONEqual(t, "resolved input", fixture.ExpectedResolvedInput, gotInput)
			assertFixtureDepsConsumed(t, inputDeps)

			outputDeps := buildDeps(t, fixture, expectedInput)
			output, err := builder.BuildGeneric(context.Background(), req, outputDeps)
			if err != nil {
				t.Fatal(err)
			}
			assertJSONEqual(t, "params", fixture.ExpectedParams, output.Params)
			expectedTx, err := publicbuildertest.DecodeExpectedTx(fixture)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(output.TxObject, expectedTx) {
				t.Fatalf("txObject mismatch\n got: %#v\nwant: %#v", output.TxObject, expectedTx)
			}
			assertFixtureDepsConsumed(t, outputDeps)
		})
	}
}

func TestBuildRoutePlanSumsMissingSwapAmounts(t *testing.T) {
	srcA := resolved.DecimalString("10")
	srcB := resolved.DecimalString("15")
	destA := resolved.DecimalString("20")
	destB := resolved.DecimalString("25")
	routePlan, err := builder.BuildRoutePlan(builder.PriceRoute{
		BestRoute: []builder.PriceRouteRoute{{
			Percent: 100,
			Swaps: []builder.PriceRouteSwap{{
				SrcToken:  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				DestToken: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				SwapExchanges: []builder.PriceRouteSwapExchange{
					{Exchange: "B", Percent: 60, SrcAmount: srcA, DestAmount: destA},
					{Exchange: "A", Percent: 40, SrcAmount: srcB, DestAmount: destB},
				},
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	swap := routePlan.Routes[0].Swaps[0]
	if swap.SrcAmount != "25" || swap.DestAmount != "45" {
		t.Fatalf("summed amounts mismatch: got src=%s dest=%s", swap.SrcAmount, swap.DestAmount)
	}
}

func TestDetectExecutorRouteShapes(t *testing.T) {
	tests := []struct {
		name   string
		side   resolved.Side
		routes []builder.PriceRouteRoute
		want   resolved.ExecutorType
	}{
		{
			name:   "single SELL",
			side:   resolved.SideSell,
			routes: []builder.PriceRouteRoute{route(100, swap(100))},
			want:   resolved.Executor01,
		},
		{
			name:   "horizontal SELL",
			side:   resolved.SideSell,
			routes: []builder.PriceRouteRoute{route(100, swap(100), swap(100))},
			want:   resolved.Executor01,
		},
		{
			name:   "vertical SELL",
			side:   resolved.SideSell,
			routes: []builder.PriceRouteRoute{route(100, swap(50, 50))},
			want:   resolved.Executor02,
		},
		{
			name:   "vertical horizontal SELL",
			side:   resolved.SideSell,
			routes: []builder.PriceRouteRoute{route(100, swap(100), swap(50, 50))},
			want:   resolved.Executor02,
		},
		{
			name:   "mega SELL",
			side:   resolved.SideSell,
			routes: []builder.PriceRouteRoute{route(90, swap(100)), route(10, swap(100))},
			want:   resolved.Executor02,
		},
		{
			name:   "single BUY",
			side:   resolved.SideBuy,
			routes: []builder.PriceRouteRoute{route(100, swap(100))},
			want:   resolved.Executor03,
		},
		{
			name:   "vertical BUY",
			side:   resolved.SideBuy,
			routes: []builder.PriceRouteRoute{route(100, swap(50, 50))},
			want:   resolved.Executor03,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := builder.DetectExecutor(priceRoute(tt.side, tt.routes))
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("executor mismatch: got %s want %s", got, tt.want)
			}
		})
	}

	t.Run("single WETH route ignores destination token and route percent", func(t *testing.T) {
		wethRoute := priceRoute(resolved.SideSell, []builder.PriceRouteRoute{{
			Percent: 42,
			Swaps: []builder.PriceRouteSwap{{
				SrcToken:  resolved.NativeTokenAddress,
				DestToken: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				SwapExchanges: []builder.PriceRouteSwapExchange{{
					Exchange:   "Weth",
					Percent:    7,
					SrcAmount:  "100",
					DestAmount: "90",
				}},
			}},
		}})
		wethRoute.SrcToken = resolved.NativeTokenAddress
		got, err := builder.DetectExecutor(wethRoute)
		if err != nil {
			t.Fatal(err)
		}
		if got != resolved.ExecutorWETH {
			t.Fatalf("executor mismatch: got %s want %s", got, resolved.ExecutorWETH)
		}
	})

	t.Run("unsupported single-route percent", func(t *testing.T) {
		_, err := builder.DetectExecutor(priceRoute(resolved.SideSell, []builder.PriceRouteRoute{route(90, swap(100))}))
		if err == nil || !strings.Contains(err.Error(), "Route type is not supported yet") {
			t.Fatalf("expected route-type error, got %v", err)
		}
	})
}

func TestBuildGenericRejectsBeforeDexLookup(t *testing.T) {
	collection, err := publicbuildertest.LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}
	fixture, ok := collection.FixtureByName("executor01-simple-sell-approved")
	if !ok {
		t.Fatal("missing fixture")
	}
	req, err := publicbuildertest.DecodeBuildRequest(fixture)
	if err != nil {
		t.Fatal(err)
	}
	expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		mutate func(*builder.BuildRequest)
		want   string
	}{
		{
			name:   "invalid side",
			mutate: func(req *builder.BuildRequest) { req.PriceRoute.Side = "UNKNOWN" },
			want:   "invalid side: UNKNOWN",
		},
		{
			name: "unsupported method",
			mutate: func(req *builder.BuildRequest) {
				req.PriceRoute.ContractMethod = resolved.ContractMethodSwapExactAmountInOnUniswapV2
			},
			want: "unsupported generic contract method",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := req
			tt.mutate(&req)
			deps := buildDeps(t, fixture, expectedInput)
			_, err := builder.BuildGeneric(context.Background(), req, deps)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("expected %q error, got %v", tt.want, err)
			}
			registry := deps.DexRegistry.(*publicbuildertest.FixtureDexRegistry)
			if err := registry.AssertConsumed(); err == nil {
				t.Fatal("expected DEX calls to remain unconsumed")
			}
		})
	}

	t.Run("network mismatch", func(t *testing.T) {
		req := req
		deps := buildDeps(t, fixture, expectedInput)
		deps.EncodingContext.Network++
		_, err := builder.BuildGeneric(context.Background(), req, deps)
		if err == nil || !strings.Contains(err.Error(), "network mismatch") {
			t.Fatalf("expected network mismatch error, got %v", err)
		}
		registry := deps.DexRegistry.(*publicbuildertest.FixtureDexRegistry)
		if err := registry.AssertConsumed(); err == nil {
			t.Fatal("expected DEX calls to remain unconsumed")
		}
	})

	t.Run("Executor02 exact out fence", func(t *testing.T) {
		assertBuildGenericRejectsBeforeDexLookup(
			t,
			collection,
			"executor02-vertical-branch-sell",
			func(req *builder.BuildRequest) {
				req.PriceRoute.ContractMethod = resolved.ContractMethodSwapExactAmountOut
			},
			"Executor02 BUY routes are not implemented in Phase 2c",
		)
	})

	t.Run("Executor03 exact in fence", func(t *testing.T) {
		assertBuildGenericRejectsBeforeDexLookup(
			t,
			collection,
			"executor03-buy",
			func(req *builder.BuildRequest) {
				req.PriceRoute.ContractMethod = resolved.ContractMethodSwapExactAmountIn
			},
			"Executor03 non-BUY routes are not implemented in Phase 2d",
		)
	})
}

func TestDefaultWethProviderCalldata(t *testing.T) {
	weth := resolved.Address("0x1111111111111111111111111111111111111111")
	provider := builder.DefaultWethProviderForTest(weth)

	plan, err := provider.GetDepositWithdrawCallData(context.Background(), builder.WethCallDataInput{
		SrcAmountWeth:  "7",
		DestAmountWeth: "5",
		Side:           resolved.SideBuy,
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Deposit == nil {
		t.Fatal("expected deposit plan")
	}
	if plan.Deposit.Callee != weth || plan.Deposit.Calldata != "0xd0e30db0" || plan.Deposit.Value != "7" {
		t.Fatalf("deposit mismatch: %#v", plan.Deposit)
	}
	if plan.Withdraw == nil {
		t.Fatal("expected withdraw plan")
	}
	wantWithdraw := resolved.HexBytes(
		"0x2e1a7d4d" +
			"0000000000000000000000000000000000000000000000000000000000000005",
	)
	if plan.Withdraw.Callee != resolved.NullAddress ||
		plan.Withdraw.Calldata != wantWithdraw ||
		plan.Withdraw.Value != "0" {
		t.Fatalf("withdraw mismatch: %#v", plan.Withdraw)
	}
}

func TestHasAnyRouteWithEthAndDifferentNeedWrapNative(t *testing.T) {
	weth := resolved.Address("0x1111111111111111111111111111111111111111")
	routePlan := resolved.RoutePlan{Routes: []resolved.RoutePlanRoute{{
		Percent: 100,
		Swaps: []resolved.RoutePlanSwap{{
			SrcToken:   resolved.NativeTokenAddress,
			DestToken:  weth,
			SrcAmount:  "100",
			DestAmount: "90",
			SwapExchanges: []resolved.RoutePlanSwapExchange{
				{Exchange: "B", Percent: 50, SrcAmount: "50", DestAmount: "45"},
				{Exchange: "A", Percent: 50, SrcAmount: "50", DestAmount: "45"},
			},
		}},
	}}}
	same := []resolved.ResolvedLeg{
		resolvedLeg(0, 0, 0, false),
		resolvedLeg(0, 0, 1, false),
	}
	if builder.HasAnyRouteWithEthAndDifferentNeedWrapNativeForTest(routePlan, same, weth) {
		t.Fatal("same needWrapNative values should not be mixed")
	}
	mixed := []resolved.ResolvedLeg{
		resolvedLeg(0, 0, 0, false),
		resolvedLeg(0, 0, 1, true),
	}
	if !builder.HasAnyRouteWithEthAndDifferentNeedWrapNativeForTest(routePlan, mixed, weth) {
		t.Fatal("mixed needWrapNative values should be detected")
	}

	nonEthRoutePlan := routePlan
	nonEthRoutePlan.Routes[0].Swaps[0].SrcToken = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	nonEthRoutePlan.Routes[0].Swaps[0].DestToken = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	if builder.HasAnyRouteWithEthAndDifferentNeedWrapNativeForTest(nonEthRoutePlan, mixed, weth) {
		t.Fatal("non ETH/WETH routes should be ignored")
	}
}

func TestPublicDefaultResolution(t *testing.T) {
	collection, err := publicbuildertest.LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}

	t.Run("SELL quoted amount defaults to destination amount", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			req.QuotedAmount = nil
		})
		if input.QuotedAmount != input.DestAmount {
			t.Fatalf("quoted amount mismatch: got %s want %s", input.QuotedAmount, input.DestAmount)
		}
	})

	t.Run("empty quoted amount defaults like nil", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			empty := resolved.DecimalString("")
			req.QuotedAmount = &empty
		})
		if input.QuotedAmount != input.DestAmount {
			t.Fatalf("quoted amount mismatch: got %s want %s", input.QuotedAmount, input.DestAmount)
		}
	})

	t.Run("BUY quoted amount defaults to source amount", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor03-buy", func(req *builder.BuildRequest) {
			req.QuotedAmount = nil
		})
		if input.QuotedAmount != input.SrcAmount {
			t.Fatalf("quoted amount mismatch: got %s want %s", input.QuotedAmount, input.SrcAmount)
		}
	})

	t.Run("nil permit defaults to 0x", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			req.Permit = nil
		})
		if input.Permit != "0x" {
			t.Fatalf("permit mismatch: got %s want 0x", input.Permit)
		}
	})

	t.Run("empty permit defaults to 0x", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			empty := resolved.HexBytes("")
			req.Permit = &empty
		})
		if input.Permit != "0x" {
			t.Fatalf("permit mismatch: got %s want 0x", input.Permit)
		}
	})

	t.Run("nil beneficiary becomes null address", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			req.Beneficiary = nil
		})
		if input.Beneficiary != resolved.NullAddress {
			t.Fatalf("beneficiary mismatch: got %s want %s", input.Beneficiary, resolved.NullAddress)
		}
	})

	t.Run("beneficiary equal to user becomes null address", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			user := req.UserAddress
			req.Beneficiary = &user
		})
		if input.Beneficiary != resolved.NullAddress {
			t.Fatalf("beneficiary mismatch: got %s want %s", input.Beneficiary, resolved.NullAddress)
		}
	})

	t.Run("nil isCapSurplus defaults true", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			req.IsCapSurplus = nil
		})
		fee := decodeFee(t, input.Fee)
		if !fee.IsCapSurplus {
			t.Fatal("expected isCapSurplus to default true")
		}
	})

	t.Run("explicit false isCapSurplus stays false", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			value := false
			req.IsCapSurplus = &value
		})
		fee := decodeFee(t, input.Fee)
		if fee.IsCapSurplus {
			t.Fatal("expected explicit isCapSurplus=false to be preserved")
		}
	})

	t.Run("all empty gas fields omit gas", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			req.GasPrice = nil
			req.MaxFeePerGas = nil
			req.MaxPriorityFeePerGas = nil
		})
		if input.Gas != nil {
			t.Fatalf("expected nil gas, got %#v", input.Gas)
		}
	})

	t.Run("partial gas fields are preserved", func(t *testing.T) {
		input := buildGenericInputFromFixture(t, collection, "executor01-simple-sell-approved", func(req *builder.BuildRequest) {
			req.GasPrice = nil
			maxFee := resolved.DecimalString("123")
			req.MaxFeePerGas = &maxFee
			req.MaxPriorityFeePerGas = nil
		})
		if input.Gas == nil || input.Gas.MaxFeePerGas != "123" || input.Gas.GasPrice != "" || input.Gas.MaxPriorityFeePerGas != "" {
			t.Fatalf("gas mismatch: %#v", input.Gas)
		}
	})
}

func TestRouteWalkOrderIsPreserved(t *testing.T) {
	collection, err := publicbuildertest.LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}
	fixture, ok := collection.FixtureByName("executor01-simple-sell-approved")
	if !ok {
		t.Fatal("missing fixture")
	}
	expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
	if err != nil {
		t.Fatal(err)
	}
	registry := &recordingDexRegistry{}
	deps := buildDeps(t, fixture, expectedInput)
	deps.DexRegistry = registry
	deps.ApprovalChecker = nil
	deps.Options.SkipApprovalCheck = true

	srcAmount := resolved.DecimalString("100")
	destAmount := resolved.DecimalString("90")
	req := builder.BuildRequest{
		PriceRoute: builder.PriceRoute{
			Network:        1,
			BlockNumber:    1,
			ContractMethod: resolved.ContractMethodSwapExactAmountIn,
			Side:           resolved.SideSell,
			SrcToken:       "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			DestToken:      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			SrcAmount:      "100",
			DestAmount:     "90",
			BestRoute: []builder.PriceRouteRoute{{
				Percent: 100,
				Swaps: []builder.PriceRouteSwap{{
					SrcToken:   "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					DestToken:  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					SrcAmount:  &srcAmount,
					DestAmount: &destAmount,
					SwapExchanges: []builder.PriceRouteSwapExchange{
						{Exchange: "ZDex", Percent: 50, SrcAmount: "50", DestAmount: "45"},
						{Exchange: "ADex", Percent: 50, SrcAmount: "50", DestAmount: "45"},
					},
				}},
			}},
		},
		MinMaxAmount:      "90",
		UserAddress:       "0x9999999999999999999999999999999999999999",
		PartnerAddress:    resolved.NullAddress,
		PartnerFeePercent: "0",
		UUID:              "route-order-test",
	}

	input, err := builder.BuildGenericInputForTest(context.Background(), req, deps)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(registry.calls, []string{"ZDex", "ADex"}) {
		t.Fatalf("DEX call order mismatch: got %v", registry.calls)
	}
	if len(input.ResolvedLegs) != 2 {
		t.Fatalf("resolved leg count mismatch: got %d", len(input.ResolvedLegs))
	}
	var first, second resolved.ResolvedLeg
	if err := json.Unmarshal(input.ResolvedLegs[0], &first); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(input.ResolvedLegs[1], &second); err != nil {
		t.Fatal(err)
	}
	if first.SwapExchangeIndex != 0 || second.SwapExchangeIndex != 1 {
		t.Fatalf("resolved leg order mismatch: first=%d second=%d", first.SwapExchangeIndex, second.SwapExchangeIndex)
	}
}

func TestRoutePositionKeyFormat(t *testing.T) {
	if got := builder.RoutePositionKey(1, 2, 3); got != "1:2:3" {
		t.Fatalf("route position key mismatch: got %s want 1:2:3", got)
	}
}

func TestApprovalCheckerOptions(t *testing.T) {
	collection, err := publicbuildertest.LoadPublicBuilderFixtures()
	if err != nil {
		t.Fatal(err)
	}

	t.Run("nil checker allowed with no requests", func(t *testing.T) {
		fixture, ok := collection.FixtureByName("weth-only-eth-to-weth")
		if !ok {
			t.Fatal("missing fixture")
		}
		req, err := publicbuildertest.DecodeBuildRequest(fixture)
		if err != nil {
			t.Fatal(err)
		}
		expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
		if err != nil {
			t.Fatal(err)
		}
		deps := buildDeps(t, fixture, expectedInput)
		deps.ApprovalChecker = nil
		if _, err := builder.BuildGeneric(context.Background(), req, deps); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("nil checker fails with requests", func(t *testing.T) {
		fixture, ok := collection.FixtureByName("executor01-simple-sell-approved")
		if !ok {
			t.Fatal("missing fixture")
		}
		req, err := publicbuildertest.DecodeBuildRequest(fixture)
		if err != nil {
			t.Fatal(err)
		}
		expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
		if err != nil {
			t.Fatal(err)
		}
		deps := buildDeps(t, fixture, expectedInput)
		deps.ApprovalChecker = nil
		_, err = builder.BuildGeneric(context.Background(), req, deps)
		if err == nil || !strings.Contains(err.Error(), "approval checker is required") {
			t.Fatalf("expected approval checker error, got %v", err)
		}
	})

	t.Run("skip approval check does not call checker", func(t *testing.T) {
		fixture, ok := collection.FixtureByName("executor01-simple-sell-approval-missing")
		if !ok {
			t.Fatal("missing fixture")
		}
		req, err := publicbuildertest.DecodeBuildRequest(fixture)
		if err != nil {
			t.Fatal(err)
		}
		expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
		if err != nil {
			t.Fatal(err)
		}
		deps := buildDeps(t, fixture, expectedInput)
		checker := deps.ApprovalChecker.(*publicbuildertest.FixtureApprovalChecker)
		deps.Options.SkipApprovalCheck = true
		output, err := builder.BuildGeneric(context.Background(), req, deps)
		if err != nil {
			t.Fatal(err)
		}
		if checker.Called {
			t.Fatal("approval checker should not be called")
		}
		assertJSONEqual(t, "params", fixture.ExpectedParams, output.Params)
	})

	t.Run("decision count mismatch", func(t *testing.T) {
		fixture, ok := collection.FixtureByName("executor01-simple-sell-approved")
		if !ok {
			t.Fatal("missing fixture")
		}
		req, err := publicbuildertest.DecodeBuildRequest(fixture)
		if err != nil {
			t.Fatal(err)
		}
		expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
		if err != nil {
			t.Fatal(err)
		}
		deps := buildDeps(t, fixture, expectedInput)
		checker := deps.ApprovalChecker.(*publicbuildertest.FixtureApprovalChecker)
		checker.Decisions = append(checker.Decisions, false)
		_, err = builder.BuildGeneric(context.Background(), req, deps)
		if err == nil || !strings.Contains(err.Error(), "approval decision length must match approval request count") {
			t.Fatalf("expected decision count error, got %v", err)
		}
	})
}

func buildDeps(t *testing.T, fixture publicbuildertest.Fixture, expectedInput resolved.BuildInput) builder.Deps {
	t.Helper()

	resolvedDeps, err := resolvedtest.BuildDepsFromFixtureInput(expectedInput)
	if err != nil {
		t.Fatal(err)
	}
	expectedDexCalls, err := publicbuildertest.DecodeExpectedDexCalls(fixture)
	if err != nil {
		t.Fatal(err)
	}
	expectedApprovalRequests, err := publicbuildertest.DecodeExpectedApprovalRequests(fixture)
	if err != nil {
		t.Fatal(err)
	}
	approvalDecisions, err := publicbuildertest.DecodeApprovalDecisions(fixture)
	if err != nil {
		t.Fatal(err)
	}

	return builder.Deps{
		EncodingContext: resolvedDeps.EncodingContext,
		AugustusV6ABI:   resolvedDeps.AugustusV6ABI,
		ExecutorFactory: executor.NewFactory(),
		DexRegistry:     publicbuildertest.NewFixtureDexRegistry(expectedDexCalls),
		ApprovalChecker: &publicbuildertest.FixtureApprovalChecker{
			Expected:        expectedApprovalRequests,
			Decisions:       approvalDecisions,
			ExpectedSpender: expectedInput.ExecutorAddress,
		},
		Options: builder.Options{
			SkipApprovalCheck: fixture.Input.Options.SkipApprovalCheck,
		},
	}
}

func assertFixtureDepsConsumed(t *testing.T, deps builder.Deps) {
	t.Helper()

	registry := deps.DexRegistry.(*publicbuildertest.FixtureDexRegistry)
	if err := registry.AssertConsumed(); err != nil {
		t.Fatal(err)
	}
	if checker, ok := deps.ApprovalChecker.(*publicbuildertest.FixtureApprovalChecker); ok &&
		len(checker.Expected) > 0 &&
		!deps.Options.SkipApprovalCheck &&
		!checker.Called {
		t.Fatal("approval checker was not called")
	}
}

func assertJSONEqual(t *testing.T, label string, expectedRaw json.RawMessage, got any) {
	t.Helper()

	gotRaw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("%s: marshal got: %v", label, err)
	}
	expectedValue := decodeJSONForCompare(t, expectedRaw)
	gotValue := decodeJSONForCompare(t, gotRaw)
	if !reflect.DeepEqual(gotValue, expectedValue) {
		t.Fatalf("%s mismatch\n got: %s\nwant: %s", label, gotRaw, expectedRaw)
	}
}

func decodeJSONForCompare(t *testing.T, raw []byte) any {
	t.Helper()

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func priceRoute(side resolved.Side, routes []builder.PriceRouteRoute) builder.PriceRoute {
	return builder.PriceRoute{
		Network:        1,
		BlockNumber:    1,
		ContractMethod: resolved.ContractMethodSwapExactAmountIn,
		Side:           side,
		SrcToken:       "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		DestToken:      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		SrcAmount:      "100",
		DestAmount:     "90",
		BestRoute:      routes,
	}
}

func route(percent float64, swaps ...builder.PriceRouteSwap) builder.PriceRouteRoute {
	return builder.PriceRouteRoute{Percent: percent, Swaps: swaps}
}

func swap(exchangePercents ...float64) builder.PriceRouteSwap {
	exchanges := make([]builder.PriceRouteSwapExchange, len(exchangePercents))
	for index, percent := range exchangePercents {
		exchanges[index] = builder.PriceRouteSwapExchange{
			Exchange:   "Dex",
			Percent:    percent,
			SrcAmount:  "100",
			DestAmount: "90",
		}
	}
	return builder.PriceRouteSwap{
		SrcToken:      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		DestToken:     "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		SwapExchanges: exchanges,
	}
}

func assertBuildGenericRejectsBeforeDexLookup(
	t *testing.T,
	collection *publicbuildertest.Collection,
	fixtureName string,
	mutate func(*builder.BuildRequest),
	want string,
) {
	t.Helper()

	fixture, ok := collection.FixtureByName(fixtureName)
	if !ok {
		t.Fatalf("missing fixture %s", fixtureName)
	}
	req, err := publicbuildertest.DecodeBuildRequest(fixture)
	if err != nil {
		t.Fatal(err)
	}
	expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
	if err != nil {
		t.Fatal(err)
	}
	mutate(&req)
	deps := buildDeps(t, fixture, expectedInput)
	_, err = builder.BuildGeneric(context.Background(), req, deps)
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("expected %q error, got %v", want, err)
	}
	registry := deps.DexRegistry.(*publicbuildertest.FixtureDexRegistry)
	if err := registry.AssertConsumed(); err == nil {
		t.Fatal("expected DEX calls to remain unconsumed")
	}
}

func buildGenericInputFromFixture(
	t *testing.T,
	collection *publicbuildertest.Collection,
	fixtureName string,
	mutate func(*builder.BuildRequest),
) resolved.BuildInput {
	t.Helper()

	fixture, ok := collection.FixtureByName(fixtureName)
	if !ok {
		t.Fatalf("missing fixture %s", fixtureName)
	}
	req, err := publicbuildertest.DecodeBuildRequest(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if mutate != nil {
		mutate(&req)
	}
	expectedInput, err := publicbuildertest.DecodeExpectedResolvedInput(fixture)
	if err != nil {
		t.Fatal(err)
	}
	deps := buildDeps(t, fixture, expectedInput)
	input, err := builder.BuildGenericInputForTest(context.Background(), req, deps)
	if err != nil {
		t.Fatal(err)
	}
	assertFixtureDepsConsumed(t, deps)
	return input
}

type feeForTest struct {
	IsCapSurplus bool `json:"isCapSurplus"`
}

func decodeFee(t *testing.T, raw json.RawMessage) feeForTest {
	t.Helper()

	var fee feeForTest
	if err := json.Unmarshal(raw, &fee); err != nil {
		t.Fatal(err)
	}
	return fee
}

func resolvedLeg(routeIndex, swapIndex, swapExchangeIndex int, needWrapNative bool) resolved.ResolvedLeg {
	return resolved.ResolvedLeg{
		RouteIndex:        routeIndex,
		SwapIndex:         swapIndex,
		SwapExchangeIndex: swapExchangeIndex,
		ExchangeParam: resolved.DexExchangeBuildParam{
			NeedWrapNative: resolved.RawBool{
				Value:   needWrapNative,
				Valid:   true,
				Present: true,
			},
		},
	}
}

type recordingDexRegistry struct {
	calls []string
}

func (r *recordingDexRegistry) GetDexEncoder(_ context.Context, _ int, dexKey string) (builder.DexEncoder, error) {
	r.calls = append(r.calls, dexKey)
	return recordingDexEncoder{}, nil
}

type recordingDexEncoder struct{}

func (recordingDexEncoder) NeedWrapNative(context.Context, builder.NeedWrapNativeInput) (bool, error) {
	return false, nil
}

func (recordingDexEncoder) GetDexParam(context.Context, builder.DexParamInput) (builder.DexExchangeParam, error) {
	return builder.DexExchangeParam{
		NeedWrapNative:      false,
		ExchangeData:        "0x",
		TargetExchange:      "0x1111111111111111111111111111111111111111",
		DexFuncHasRecipient: true,
	}, nil
}
