# DEX Encoder Conformance Fixtures

These fixtures capture the current V6 TypeScript encoder inputs and outputs
before `GenericSwapTransactionBuilder` is routed through DEX encoder ports.

They are generated from the resolved-build fixture orchestration metadata. Run:

```bash
yarn fixtures:dex-encoder:generate
```

Generic fixture names use
`{resolved-fixture-name}-r{routeIndex}-s{swapIndex}-e{swapExchangeIndex}-{dex-key}`.
Direct fixture names reuse the resolved direct fixture name.

The Jest suite in this directory validates the fixture schema, canonical JSON
format, and coverage against the resolved-build fixture set.
