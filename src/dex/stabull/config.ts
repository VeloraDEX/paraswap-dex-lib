import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const StabullConfig: DexConfigMap<DexParams> = {
  Stabull: {
    [Network.MAINNET]: {
      router: '0x871af97122d08890193e8d6465015f6d9e2889b2',
      quoteCurrency: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      pools: {
        '0xe37d763c7c4cdd9a8f085f7db70139a0843529f3': {
          tokens: [
            {
              address: '0xda446fad08277b4d2591536f204e018f32b6831c',
              decimals: 18,
            }, // NZDS
            {
              address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 6,
            }, // USDC
          ],
        },
        '0x865040f92ac6cca1b9683c03d843799d8e6d1282': {
          tokens: [
            {
              address: '0xdb25f211ab05b1c97d595516f45794528a807ad8',
              decimals: 2,
            }, // EURS
            {
              address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 6,
            }, // USDC
          ],
        },
        '0xc1a195fdb17da5771d470a232545550a7d264809': {
          tokens: [
            {
              address: '0x2c537e5624e4af88a7ae4060c022609376c8d0eb',
              decimals: 6,
            }, // TRYB
            {
              address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 6,
            }, // USDC
          ],
        },
        '0x402878106b88b41fad1200b47e998c8effd0d887': {
          tokens: [
            {
              address: '0x86b4dbe5d203e634a12364c0e428fa242a3fba98',
              decimals: 18,
            }, // 1GBP
            {
              address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 6,
            }, // USDC
          ],
        },
        '0x01e4013c478d7f02112c3cf178f2771c842edbd0': {
          tokens: [
            {
              address: '0xc08512927d12348f6620a698105e1baac6ecd911',
              decimals: 6,
            }, // GYEN
            {
              address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 6,
            }, // USDC
          ],
        },
      },
    },
    [Network.POLYGON]: {
      router: '0x0c1f53e7b5a770f4c0d4bef139f752eeb08de88d',
      quoteCurrency: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      pools: {
        '0xdcb7efaca996fe2985138bf31b647efcd1d0901a': {
          tokens: [
            {
              address: '0xfbbe4b730e1e77d02dc40fedf9438e2802eab3b5',
              decimals: 18,
            }, // NZDS
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
        '0xf80b3a8977d34a443a836a380b2fce69a1a4e819': {
          tokens: [
            {
              address: '0xe111178a87a3bff0c8d18decba5798827539ae99',
              decimals: 2,
            }, // EURS
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
        '0x55bdf7f0223e8b1d509141a8d852dd86b3553d59': {
          tokens: [
            {
              address: '0x4fb71290ac171e1d144f7221d882becac7196eb5',
              decimals: 6,
            }, // TRYB
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
        '0x509aacb7746166252ecb0d62bfba097cc9731e20': {
          tokens: [
            {
              address: '0xdc3326e71d45186f113a2f448984ca0e8d201995',
              decimals: 6,
            }, // XSGD
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
        '0xce0abd182d2cf5844f2a0cb52cfcc55d4ff4fcba': {
          tokens: [
            {
              address: '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc',
              decimals: 4,
            }, // BRZ
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
        '0x3d4436ba3ae7e0e6361c83ab940ea779cd598206': {
          tokens: [
            {
              address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
              decimals: 6,
            }, // USDT
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
        '0xa52508b1822ca9261b33213b233694f846abd0ed': {
          tokens: [
            {
              address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
              decimals: 18,
            }, // DAI
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
        '0x1233003461f654cf1c0d7db19e753badef05a87f': {
          tokens: [
            {
              address: '0x87a25dc121db52369f4a9971f664ae5e372cf69a',
              decimals: 6,
            }, // PHPC
            {
              address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              decimals: 6,
            }, // USDC
          ],
        },
      },
    },
  },
};
