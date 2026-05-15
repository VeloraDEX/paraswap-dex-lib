package publicbuildertest

import (
	"context"
	"fmt"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/builder"
)

type RecordingDexRegistry struct {
	Inner     builder.DexRegistry
	Expected  []ExpectedDexCall
	next      int
	completed int
}

// RecordingDexRegistry validates the Go runtime call sequence against the flat
// fixture observation list. The TypeScript generator records by route position;
// both paths enforce one NeedWrapNative call followed by one GetDexParam call.
func NewRecordingDexRegistry(inner builder.DexRegistry, expected []ExpectedDexCall) *RecordingDexRegistry {
	return &RecordingDexRegistry{
		Inner:    inner,
		Expected: expected,
	}
}

func (r *RecordingDexRegistry) GetDexEncoder(ctx context.Context, network int, dexKey string) (builder.DexEncoder, error) {
	if r.Inner == nil {
		return nil, fmt.Errorf("real dex registry is required")
	}
	if r.next >= len(r.Expected) {
		return nil, fmt.Errorf("unexpected DEX lookup for %s", dexKey)
	}
	expected := r.Expected[r.next]
	if expected.NeedWrapNativeInput.Route.Network != network {
		return nil, fmt.Errorf(
			"%s: network mismatch: got %d want %d",
			expected.RoutePositionKey,
			network,
			expected.NeedWrapNativeInput.Route.Network,
		)
	}
	if expected.DexKey != dexKey {
		return nil, fmt.Errorf(
			"%s: dexKey mismatch: got %s want %s",
			expected.RoutePositionKey,
			dexKey,
			expected.DexKey,
		)
	}

	encoder, err := r.Inner.GetDexEncoder(ctx, network, dexKey)
	if err != nil {
		return nil, err
	}
	if encoder == nil {
		return nil, fmt.Errorf("%s: real DEX encoder is nil", expected.RoutePositionKey)
	}

	r.next++
	return &recordingRealDexEncoder{
		expected: expected,
		inner:    encoder,
		onDone: func() {
			r.completed++
		},
	}, nil
}

func (r *RecordingDexRegistry) AssertConsumed() error {
	if r.next != len(r.Expected) {
		return fmt.Errorf("consumed %d DEX lookups; expected %d", r.next, len(r.Expected))
	}
	if r.completed != len(r.Expected) {
		return fmt.Errorf("completed %d DEX calls; expected %d", r.completed, len(r.Expected))
	}
	return nil
}

type recordingRealDexEncoder struct {
	expected             ExpectedDexCall
	inner                builder.DexEncoder
	onDone               func()
	needWrapNativeCalled bool
	getDexParamCalled    bool
}

func (e *recordingRealDexEncoder) NeedWrapNative(ctx context.Context, input builder.NeedWrapNativeInput) (bool, error) {
	if e.needWrapNativeCalled {
		return false, fmt.Errorf("%s: duplicate needWrapNative call", e.expected.RoutePositionKey)
	}
	e.needWrapNativeCalled = true

	if !jsonEquivalent(input, e.expected.NeedWrapNativeInput) {
		return false, fmt.Errorf(
			"%s: needWrapNative input mismatch\n got: %s\nwant: %s",
			e.expected.RoutePositionKey,
			mustJSON(input),
			mustJSON(e.expected.NeedWrapNativeInput),
		)
	}

	got, err := e.inner.NeedWrapNative(ctx, input)
	if err != nil {
		return false, err
	}
	if got != e.expected.NeedWrapNative {
		return false, fmt.Errorf(
			"%s: needWrapNative result mismatch: got %t want %t",
			e.expected.RoutePositionKey,
			got,
			e.expected.NeedWrapNative,
		)
	}
	return got, nil
}

func (e *recordingRealDexEncoder) GetDexParam(ctx context.Context, input builder.DexParamInput) (builder.DexExchangeParam, error) {
	if !e.needWrapNativeCalled {
		return builder.DexExchangeParam{}, fmt.Errorf("%s: getDexParam called before needWrapNative", e.expected.RoutePositionKey)
	}
	if e.getDexParamCalled {
		return builder.DexExchangeParam{}, fmt.Errorf("%s: duplicate getDexParam call", e.expected.RoutePositionKey)
	}
	e.getDexParamCalled = true

	if !jsonEquivalent(input, e.expected.DexParamInput) {
		return builder.DexExchangeParam{}, fmt.Errorf(
			"%s: dex param input mismatch\n got: %s\nwant: %s",
			e.expected.RoutePositionKey,
			mustJSON(input),
			mustJSON(e.expected.DexParamInput),
		)
	}

	got, err := e.inner.GetDexParam(ctx, input)
	if err != nil {
		return builder.DexExchangeParam{}, err
	}
	if !jsonEquivalent(got, e.expected.DexParam) {
		return builder.DexExchangeParam{}, fmt.Errorf(
			"%s: dex param output mismatch\n got: %s\nwant: %s",
			e.expected.RoutePositionKey,
			mustJSON(got),
			mustJSON(e.expected.DexParam),
		)
	}
	e.onDone()
	return got, nil
}
