import { BytesLike, Interface, LogDescription, AbiCoder } from 'ethers';

import ERC20ABI from '../../abi/ERC20.abi.json';
import ERC721ABI from '../../abi/ERC721.abi.json';
import ERC1155ABI from '../../abi/ERC1155.abi.json';
import WETHABI from '../../abi/weth.abi.json';

import {
  ERC1155ApprovalForAll,
  ERC1155TransferBatch,
  ERC1155TransferSingle,
  ERC20Approval,
  ERC20Transfer,
  ERC721Approval,
  ERC721ApprovalForAll,
  ERC721Transfer,
  WETHDeposit,
  WETHWithdrawal,
} from './types';
import { MultiResult } from '../multi-wrapper';
import { extractSuccessAndValue, generalDecoder } from '../decoders';

export const erc20Iface = new Interface(ERC20ABI);
export const wethIface = new Interface(WETHABI);
export const erc721Iface = new Interface(ERC721ABI);
export const erc1155Iface = new Interface(ERC1155ABI);

export function toUnixTimestamp(date: Date | number): number {
  const timestamp = date instanceof Date ? date.getTime() : date;
  return Math.floor(timestamp / 1000);
}

export const uintDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): bigint => {
  return generalDecoder(result, ['uint'], 0n, value => value[0].toBigInt());
};

export const uint256ArrayDecode = (
  result: MultiResult<string> | string,
): bigint => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (isSuccess) {
    return 0n;
  }
  return BigInt(AbiCoder.defaultAbiCoder().decode(['uint256[]'], toDecode)[0]);
};

export const booleanDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): boolean => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (isSuccess) {
    return false;
  }
  return AbiCoder.defaultAbiCoder().decode(['bool'], toDecode)[0];
};

export const addressDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): string => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess) {
    return '';
  }
  return AbiCoder.defaultAbiCoder()
    .decode(['address'], toDecode)[0]
    .toLowerCase();
};

export const extractOnlySuccess = (result: MultiResult<string>): boolean =>
  result.success;

export const getBalanceERC20 = (owner: string) =>
  erc20Iface.encodeFunctionData('balanceOf', [owner]);

export const getBalanceERC721 = (id: bigint) =>
  erc721Iface.encodeFunctionData('ownerOf', [id]);

export const getBalanceERC1155 = (owner: string, id: bigint) =>
  erc1155Iface.encodeFunctionData('balanceOf', [owner, id]);

export const getAllowanceERC20 = (owner: string, operator: string) =>
  erc20Iface.encodeFunctionData('allowance', [owner, operator]);

export const isApprovedForAllERC721 = (owner: string, operator: string) =>
  erc1155Iface.encodeFunctionData('isApprovedForAll', [owner, operator]);

export const getApprovedERC721 = (id: bigint) =>
  erc721Iface.encodeFunctionData('getApproved', [id]);

export const isApprovedForAllERC1155 = (owner: string, operator: string) =>
  erc1155Iface.encodeFunctionData('isApprovedForAll', [owner, operator]);

export const decodeERC20Transfer = (
  decoded: LogDescription,
): ERC20Transfer => ({
  from: decoded.args[0].toLowerCase(),
  to: decoded.args[1].toLowerCase(),
  value: decoded.args[2].toBigInt(),
});

export const decodeERC20Approval = (
  decoded: LogDescription,
): ERC20Approval => ({
  owner: decoded.args[0].toLowerCase(),
  spender: decoded.args[1].toLowerCase(),
  value: decoded.args[2].toBigInt(),
});

export const decodeWETHDeposit = (decoded: LogDescription): WETHDeposit => ({
  dst: decoded.args[0].toLowerCase(),
  wad: decoded.args[1].toBigInt(),
});

export const decodeWETHWithdrawal = (
  decoded: LogDescription,
): WETHWithdrawal => ({
  src: decoded.args[0].toLowerCase(),
  wad: decoded.args[1].toBigInt(),
});

export const decodeERC721Transfer = (
  decoded: LogDescription,
): ERC721Transfer => ({
  from: decoded.args[0].toLowerCase(),
  to: decoded.args[1].toLowerCase(),
  tokenId: decoded.args[2].toBigInt(),
});

export const decodeERC721Approval = (
  decoded: LogDescription,
): ERC721Approval => ({
  owner: decoded.args[0].toLowerCase(),
  spender: decoded.args[1].toLowerCase(),
  tokenId: decoded.args[2].toBigInt(),
});

export const decodeERC721ApprovalForAll = (
  decoded: LogDescription,
): ERC721ApprovalForAll => ({
  owner: decoded.args[0].toLowerCase(),
  spender: decoded.args[1].toLowerCase(),
  approved: decoded.args[2],
});

export const decodeERC1155TransferSingle = (
  decoded: LogDescription,
): ERC1155TransferSingle => ({
  operator: decoded.args[0].toLowerCase(),
  from: decoded.args[1].toLowerCase(),
  to: decoded.args[2].toLowerCase(),
  id: decoded.args[3],
  value: decoded.args[4],
});

export const decodeERC1155TransferBatch = (
  decoded: LogDescription,
): ERC1155TransferBatch => ({
  operator: decoded.args[0].toLowerCase(),
  from: decoded.args[1].toLowerCase(),
  to: decoded.args[2].toLowerCase(),
  ids: decoded.args[3],
  values: decoded.args[4],
});

export const decodeERC1155ApprovalForAll = (
  decoded: LogDescription,
): ERC1155ApprovalForAll => ({
  owner: decoded.args[0].toLowerCase(),
  operator: decoded.args[1].toLowerCase(),
  approved: decoded.args[2],
});
