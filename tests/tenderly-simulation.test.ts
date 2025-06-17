import { ethers } from 'ethers';
import { TenderlySimulator } from './tenderly-simulation';

describe('Tenderly', () => {
  const tenderly = TenderlySimulator.getInstance();
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const account = '0x89f53c184ed91cd333fdec0eceeddcaea0cc28cf';
  const spender = '0x6a000f20005980200259b80c5102003040001068';

  describe('calculateAddressBalanceSlot', () => {
    it('should calculate account balance storage slot', () => {
      const balanceOfSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [9]); // usdc's `balanceOf` mapping slot
      // https://dashboard.tenderly.co/paraswap/paraswap/simulator/d7964910-d8ce-446b-a347-c4f1da1acead/debugger?trace=0.2.0.0
      const expected =
        '0x8cef03c2b7574a38d9a9e8dd69980240d41d70485643f407de33055936c48f97';
      const calculated = tenderly.calculateAddressBalanceSlot(
        balanceOfSlot,
        account,
      );
      // assert
      expect(calculated).toEqual(expected);
    });
  });

  describe('calculateAddressAllowanceSlots', () => {
    it('should calculate account balance storage slot', () => {
      const allowanceSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [10]); // usdc's `allowance` mapping slot
      // https://dashboard.tenderly.co/paraswap/paraswap/simulator/e2a6cad1-4a82-4ba7-8c3e-ef097315542c/debugger?trace=0.2.0
      const expected =
        '0x371a34ab690ce2826b137a25bfdaf43d0b93c819878de2df8877f1fb50ffb206';
      const calculated = tenderly.calculateAddressAllowanceSlot(
        allowanceSlot,
        account,
        spender,
      );
      // assert
      expect(calculated).toEqual(expected);
    });
  });

  describe('buildBalanceOfSimulationRequest', () => {
    it('should build `balanceOf` simulation request', () => {
      const request = tenderly.buildBalanceOfSimulationRequest(
        1,
        USDC,
        account,
      );

      const expectedCallData = ethers.utils.hexConcat([
        '0x70a08231', // selector
        ethers.utils.defaultAbiCoder.encode(['address'], [account]),
      ]);

      expect(request.data).toEqual(expectedCallData);
    });
  });

  describe('buildAllowanceSimulationRequest', () => {
    it('should build `allowance` simulation request', () => {
      const request = tenderly.buildAllowanceSimulationRequest(
        1,
        USDC,
        account,
        spender,
      );

      const expectedCallData = ethers.utils.hexConcat([
        '0xdd62ed3e', // selector
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'address'],
          [account, spender],
        ),
      ]);
      // assert
      expect(request.data).toEqual(expectedCallData);
    });
  });

  describe('findTokenBalanceOfSlot', () => {
    it('should find Mainnet USDC `balanceOf` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [9]);
      const foundSlot = await tenderly.findTokenBalanceOfSlot(1, USDC);
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
    });

    it('should find Mainnet USDT `balanceOf` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [2]);
      const foundSlot = await tenderly.findTokenBalanceOfSlot(1, USDT);
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
    });

    it('should find Mainnet stETH `balanceOf` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [0]);
      const foundSlot = await tenderly.findTokenBalanceOfSlot(
        1,
        '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', // Lido's `stETH`
      );
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
    });

    it('should find Mainnet aEthDai `balanceOf` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [52]);
      const foundSlot = await tenderly.findTokenBalanceOfSlot(
        1,
        '0x018008bfb33d285247A21d44E50697654f754e63', // Aave's `aEthDai`
      );
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
    });
  });

  describe('findTokenAllowanceSlot', () => {
    it('should find Mainnet USDC `allowance` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [10]);
      const foundSlot = await tenderly.findTokenAllowanceSlot(1, USDC);
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
    });

    it('should find Mainnet USDT `allowance` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [5]);
      const foundSlot = await tenderly.findTokenAllowanceSlot(1, USDT);
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
    });

    it('should find Mainnet stETH `allowance` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [1]);
      const foundSlot = await tenderly.findTokenAllowanceSlot(
        1,
        '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', // Lido's `stETH`
      );
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
    });

    it('should find Mainnet aEthDai `allowance` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [53]);
      const foundSlot = await tenderly.findTokenAllowanceSlot(
        1,
        '0x018008bfb33d285247A21d44E50697654f754e63', // Aave's `aEthDai`
      );
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
      expect(foundSlot.stateProxy).toBeUndefined();
    });

    it('should find Mainnet SNX `allowance` storage slot', async () => {
      const expectedSlot = ethers.utils.defaultAbiCoder.encode(['uint'], [4]);
      const foundSlot = await tenderly.findTokenAllowanceSlot(
        1,
        '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', // SNX
      );
      // assert
      expect(foundSlot.slot).toEqual(expectedSlot);
      expect(foundSlot.stateProxy).toEqual(
        '0x5b1b5fea1b99d83ad479df0c222f0492385381dd',
      );
    });
  });
});
