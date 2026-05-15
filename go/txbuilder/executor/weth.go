package executor

import "github.com/paraswap/paraswap-dex-lib/go/txbuilder/resolved"

type WETHBuilder struct{}

func NewWETHBuilder() WETHBuilder {
	return WETHBuilder{}
}

func (WETHBuilder) BuildBytecode(resolved.ExecutorBytecodeBuildInput) (resolved.HexBytes, error) {
	return resolved.HexBytes("0x"), nil
}
