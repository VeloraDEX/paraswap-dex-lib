import { Executor01BytecodeBuilder } from './Executor01BytecodeBuilder';
import { Executor02BytecodeBuilder } from './Executor02BytecodeBuilder';
import { Executor03BytecodeBuilder } from './Executor03BytecodeBuilder';
import { WETHBytecodeBuilder } from './WETHBytecodeBuilder';
import { ExecutorBytecodeBuilder } from './ExecutorBytecodeBuilder';
import type { ExecutorEncodingContext } from './encoding-types';
import { Executors } from './types';

export function createExecutorBytecodeBuilder(
  executorType: Executors,
  context: ExecutorEncodingContext,
): ExecutorBytecodeBuilder {
  switch (executorType) {
    case Executors.ONE:
      return new Executor01BytecodeBuilder(context);
    case Executors.TWO:
      return new Executor02BytecodeBuilder(context);
    case Executors.THREE:
      return new Executor03BytecodeBuilder(context);
    case Executors.WETH:
      return new WETHBytecodeBuilder(context);
    default:
      throw new Error(`${executorType} is not supported`);
  }
}
