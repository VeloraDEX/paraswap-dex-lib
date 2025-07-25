import { NULL_ADDRESS } from '../../../constants';
import { IDexHelper } from '../../../dex-helper';
import { ERC4626_previewRedeem } from '../getOnChainState';

export async function getReservesInUnderlying(
  reserveAmount: bigint,
  vault: string,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<bigint> {
  return vault === NULL_ADDRESS
    ? reserveAmount
    : await ERC4626_previewRedeem(reserveAmount, vault, blockNumber, dexHelper);
}
