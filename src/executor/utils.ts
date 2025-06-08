import { FunctionFragment, Interface } from 'ethers';
import { RETURN_AMOUNT_POS_0, RETURN_AMOUNT_POS_32 } from './constants';

export const extractReturnAmountPosition = (
  iface: Interface,
  functionName: string | FunctionFragment,
  outputName = '',
  outputIndex = 0, // for the cases when the only output is an array with static type
): number => {
  const func =
    typeof functionName === 'string'
      ? iface.getFunction(functionName)
      : functionName;

  if (!func) {
    throw new Error(
      `Function ${functionName} was not found in the provided abi`,
    );
  }

  const outputs = func.outputs || [];
  const index = outputs.findIndex(
    ({ name }) => name === outputName || (outputName === '' && name === null),
  );

  if (index < 0) {
    throw new Error(
      `Function ${functionName} was not found in the provided abi`,
    );
  }

  if (index === 0) {
    if (
      outputs[0].baseType === 'array' &&
      !outputs[0].arrayChildren!.baseType.includes('[]') && // only static internalType
      outputs.length === 1 // if array is the only output
    ) {
      return (
        RETURN_AMOUNT_POS_32 +
        RETURN_AMOUNT_POS_32 +
        outputIndex * RETURN_AMOUNT_POS_32
      ); // dynamic calldata (offset + length + position of the element in the array)
    }
    if (outputs[0].baseType === 'tuple' || outputs[0].baseType === 'struct') {
      throw new Error(
        `extractReturnAmountPosition doesn't support outputs of type struct or tuple for the only output.`,
      );
    }

    return RETURN_AMOUNT_POS_0;
  }

  let position = RETURN_AMOUNT_POS_0;
  let curIndex = 0;
  while (curIndex < index) {
    const output = outputs[curIndex];

    if (output.type.includes('[]') || output.type.includes('struct')) {
      throw new Error(
        `extractReturnAmountPosition doesn't support outputs of type array or struct. Please define returnAmountPos manually for this case.`,
      );
    }

    position += RETURN_AMOUNT_POS_32;
    curIndex++;
  }

  return position;
};
