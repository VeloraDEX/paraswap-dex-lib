package executor

import (
	"fmt"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"
)

type Factory struct{}

func NewFactory() Factory {
	return Factory{}
}

func (Factory) CreateExecutorBytecodeBuilder(
	executorType resolved.ExecutorType,
	context resolved.EncodingContext,
) (resolved.ExecutorBytecodeBuilder, error) {
	switch executorType {
	case resolved.Executor01:
		return NewExecutor01Builder(context), nil
	default:
		return nil, fmt.Errorf("executor type not supported by Go bytecode factory: %s", executorType)
	}
}
