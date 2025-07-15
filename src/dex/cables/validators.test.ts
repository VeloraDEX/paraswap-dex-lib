import Joi from 'joi';
import {
  pairsResponseValidator,
  pricesResponseValidator,
  tokensResponseValidator,
  blacklistResponseValidator,
} from './validators'; //

describe('Validation Schemas', () => {
  describe('pairsResponseValidator', () => {
    it('should validate correct pairs response', () => {
      const validData = {
        pairs: { '43114': { 'USDC/USDT': { base: 'USDC', quote: 'USDT' } } },
      };
      const { error } = pairsResponseValidator.validate(validData);
      expect(error).toBeUndefined();
    });

    it('should invalidate incorrect pairs response', () => {
      const invalidData = { pairs: { '43114': 'USDC/USDT' } };
      const { error } = pairsResponseValidator.validate(invalidData);
      expect(error).toBeDefined();
    });
  });

  describe('pricesResponseValidator', () => {
    it('should validate correct prices response', () => {
      const validData = {
        prices: {
          '43114': {
            'USDC/USDT': {
              bids: [
                ['0.9996', '244305.9'],
                ['0.9995', '236021.6'],
              ],
              asks: [
                ['0.9996', '244305.9'],
                ['0.9995', '236021.6'],
              ],
            },
          },
        },
      };
      const { error } = pricesResponseValidator.validate(validData);
      expect(error).toBeUndefined();
    });

    it('should invalidate incorrect prices response', () => {
      const invalidData = {
        prices: {
          chain1: {
            bids: [
              ['1000'], // invalid entry length
            ],
            asks: [['1010', '1']],
          },
        },
      };
      const { error } = pricesResponseValidator.validate(invalidData);
      expect(error).toBeDefined();
    });
  });

  describe('tokensResponseValidator', () => {
    it('should validate correct tokens response', () => {
      const validData = {
        tokens: {
          '43114': {
            AVAX: {
              symbol: 'AVAX',
              decimals: 18,
              name: 'AVAX',
              address: '0x0000000000000000000000000000000000000000',
            },
            WAVAX: {
              symbol: 'WAVAX',
              decimals: 18,
              name: 'WAVAX',
              address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
            },
            'WETH.e': {
              symbol: 'WETH.e',
              decimals: 18,
              name: 'WETH.e',
              address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
            },
            USDT: {
              symbol: 'USDT',
              decimals: 6,
              name: 'USDT',
              address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
            },
            USDC: {
              symbol: 'USDC',
              decimals: 6,
              name: 'USDC',
              address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
            },
            'USDC.e': {
              symbol: 'USDC.e',
              decimals: 6,
              name: 'USDC.e',
              address: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
            },
          },
        },
      };
      const { error } = tokensResponseValidator.validate(validData);
      expect(error).toBeUndefined();
    });

    it('should invalidate incorrect tokens response', () => {
      const invalidData = {
        tokens: {
          chain1: {
            ETH: {
              symbol: '', // invalid value
              name: 'Ethereum',
              description: 'A popular cryptocurrency',
              address: '0x...',
              decimals: 18,
              type: 'ERC20',
            },
          },
        },
      };
      const { error } = tokensResponseValidator.validate(invalidData);
      expect(error).toBeDefined();
    });
  });

  describe('blacklistResponseValidator', () => {
    it('should validate correct blacklist response', () => {
      const validData = {
        blacklist: ['0xAddress1', '0xAddress2'],
      };
      const { error } = blacklistResponseValidator.validate(validData);
      expect(error).toBeUndefined();
    });

    it('should invalidate incorrect blacklist response', () => {
      const invalidData = {
        blacklist: [
          '', // invalid value
        ],
      };
      const { error } = blacklistResponseValidator.validate(invalidData);
      expect(error).toBeDefined();
    });
  });
});
