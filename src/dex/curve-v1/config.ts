import { address as ThreePoolAddress } from './pools/3pool';
import { address as SUSDPoolAddress } from './pools/sUSDpool';
import { address as HBTCPoolAddress } from './pools/hBTCpool';
import { address as RenPoolAddress } from './pools/renpool';
import { address as SBTCPoolAddress } from './pools/sBTCpool';
import { address as SETHPoolAddress } from './pools/sETHpool';
import { address as STETHPoolAddress } from './pools/stETHpool';
import { address as EURSPoolAddress } from './pools/EURSpool';
import { address as DUSDPoolAddress } from './pools/DUSDpool';
import { address as BBTCPoolAddress } from './pools/bBTCpool';
import { address as GUSDPoolAddress } from './pools/GUSDpool';
import { address as HUSDPoolAddress } from './pools/HUSDpool';
import { address as LinkUSDPoolAddress } from './pools/LinkUSDpool';
import { address as MUSDPoolAddress } from './pools/MUSDpool';
import { address as OBTCPoolAddress } from './pools/oBTCpool';
import { address as PBTCPoolAddress } from './pools/pBTCpool';
import { address as RSVPoolAddress } from './pools/rsvpool';
import { address as TBTCPoolAddress } from './pools/tBTCpool';
import { address as USDKPoolAddress } from './pools/usdkpool';
import { address as USTPoolAddress } from './pools/ustpool';
import { address as SLINKPoolAddress } from './pools/sLinkpool';

import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const CurveV1Config: DexConfigMap<DexParams> = {
  CurveV1: {
    [Network.MAINNET]: {
      baseTokens: {
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6,
          reasonableVolume: 1000000000n,
        },
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          decimals: 18,
          reasonableVolume: 1000000000000000000n,
        },
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': {
          address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
          decimals: 8,
          reasonableVolume: 10000000n,
        },
        '0x6b175474e89094c44da98b954eedeac495271d0f': {
          address: '0x6b175474e89094c44da98b954eedeac495271d0f',
          decimals: 18,
          reasonableVolume: 100000000000000000000n,
        },
        '0x514910771af9ca656af840dff83e8264ecf986ca': {
          address: '0x514910771af9ca656af840dff83e8264ecf986ca',
          decimals: 18,
          reasonableVolume: 100000000000000000000n,
        },
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': {
          address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          decimals: 18,
          reasonableVolume: 1000000000000000000n,
        },
        '0xdb25f211ab05b1c97d595516f45794528a807ad8': {
          address: '0xdb25f211ab05b1c97d595516f45794528a807ad8',
          decimals: 2,
          reasonableVolume: 10000n,
        },
        '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643': {
          address: '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643',
          decimals: 8,
          reasonableVolume: 1000000n,
        },
        '0xd71ecff9342a5ced620049e616c5035f1db98620': {
          address: '0xd71ecff9342a5ced620049e616c5035f1db98620',
          decimals: 18,
          reasonableVolume: 1000000000000000000000n,
        },
        '0xC581b735A1688071A1746c968e0798D642EDE491': {
          address: '0xC581b735A1688071A1746c968e0798D642EDE491',
          decimals: 6,
          reasonableVolume: 100000n,
        },
        '0xD533a949740bb3306d119CC777fa900bA034cd52': {
          address: '0xD533a949740bb3306d119CC777fa900bA034cd52',
          decimals: 18,
          reasonableVolume: 1000000000000000000000n,
        },
      },
      eventSupportedPools: [
        ThreePoolAddress,
        SUSDPoolAddress,
        HBTCPoolAddress,
        RenPoolAddress,
        SBTCPoolAddress,
        SETHPoolAddress,
        STETHPoolAddress,
        EURSPoolAddress,
        DUSDPoolAddress,
        BBTCPoolAddress,
        GUSDPoolAddress,
        HUSDPoolAddress,
        LinkUSDPoolAddress,
        MUSDPoolAddress,
        OBTCPoolAddress,
        PBTCPoolAddress,
        RSVPoolAddress,
        TBTCPoolAddress,
        USDKPoolAddress,
        USTPoolAddress,
        SLINKPoolAddress,
      ],
      pools: {
        Compound: {
          underlying: [
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          ],
          coins: [
            '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643',
            '0x39aa39c021dfbae8fac545936693ac917d5e7563',
          ],
          address: '0xA2B47E3D5c44877cca798226B7B8118F9BFb7A56',
          name: 'Compound',
          type: 1,
          version: 2,
          isLending: true,
          isMetapool: false,
          baseToken: '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643',
        },
        USDT: {
          underlying: [
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643',
            '0x39aa39c021dfbae8fac545936693ac917d5e7563',
          ],
          address: '0x52EA46506B9CC5Ef470C5bf89f17Dc28bB35D85C',
          name: 'USDT',
          type: 1,
          version: 2,
          isLending: true,
          isMetapool: false,
          baseToken: '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643',
        },
        iEarn: {
          underlying: [
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
            '0x0000000000085d4780b73119b644ae5ecd22b376',
          ],
          coins: [
            '0x16de59092dae5ccf4a1e6439d611fd0653f0bd01',
            '0xd6ad7a6750a7593e092a9b218d66c0a814a3436e',
            '0x83f798e925bcd4017eb265844fddabb448f1707d',
            '0x73a052500105205d34daf004eab301916da8190f',
          ],
          address: '0x45f783cce6b7ff23b2ab2d70e416cdb7d6055f51',
          name: 'iEarn',
          type: 1,
          version: 2,
          isLending: true,
          isMetapool: false,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        // sUSD: {
        //   underlying: [
        //     '0x6b175474e89094c44da98b954eedeac495271d0f',
        //     '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        //     '0xdac17f958d2ee523a2206206994597c13d831ec7',
        //     '0x57ab1ec28d129707052df4df418d58a2d46d5f51',
        //   ],
        //   coins: [
        //     '0x6b175474e89094c44da98b954eedeac495271d0f',
        //     '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        //     '0xdac17f958d2ee523a2206206994597c13d831ec7',
        //     '0x57ab1ec28d129707052df4df418d58a2d46d5f51',
        //   ],
        //   address: '0xA5407eAE9Ba41422680e2e00537571bcC53efBfD',
        //   name: 'sUSD',
        //   type: 1,
        //   version: 2,
        //   isLending: false,
        //   isMetapool: false,
        //   baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        // },
        pax: {
          underlying: [
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
            '0x8e870d67f660d95d5be530380d0ec0bd388289e1',
          ],
          coins: [
            '0x99d1fa417f94dcd62bfe781a1213c092a47041bc',
            '0x9777d7e2b60bb01759d0e2f8be2095df444cb07e',
            '0x1be5d71f2da660bfdee8012ddc58d024448a0a59',
            '0x8e870d67f660d95d5be530380d0ec0bd388289e1',
          ],
          address: '0x06364f10B501e868329afBc005b3492902d6C763',
          name: 'pax',
          type: 1,
          version: 2,
          isLending: true,
          isMetapool: false,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        '3pool': {
          underlying: [],
          coins: [
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          address: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
          name: '3pool',
          type: 1,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        renBTC: {
          underlying: [],
          coins: [
            '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
            '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
          ],
          address: '0x93054188d876f558f4a66B2EF1d97d16eDf0895B',
          name: 'renBTC',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: false,
          baseToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        sBTC: {
          underlying: [],
          coins: [
            '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
            '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
            '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6',
          ],
          address: '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714',
          name: 'sBTC',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: false,
          baseToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        sETH: {
          underlying: [],
          coins: [
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            '0x5e74c9036fb86bd7ecdcb084a0673efc32ea31cb',
          ],
          address: '0xc5424B857f758E906013F3555Dad202e4bdB4567',
          name: 'sETH',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        },
        stETH: {
          underlying: [],
          coins: [
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
          ],
          address: '0xDC24316b9AE028F1497c275EB9192a3Ea0f67022',
          name: 'stETH',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          isFeeOnTransferSupported: true,
        },
        EURS: {
          underlying: [],
          coins: [
            '0xdb25f211ab05b1c97d595516f45794528a807ad8',
            '0xd71ecff9342a5ced620049e616c5035f1db98620',
          ],
          address: '0x0Ce6a5fF5217e38315f87032CF90686C96627CAA',
          name: 'EURS',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0xdb25f211ab05b1c97d595516f45794528a807ad8',
        },
        SLINK: {
          underlying: [],
          coins: [
            '0x514910771af9ca656af840dff83e8264ecf986ca',
            '0xbbc455cb4f1b9e4bfc4b73970d360c8f032efee6',
          ],
          address: '0xF178C0b5Bb7e7aBF4e12A4838C7b7c5bA2C623c0',
          name: 'SLINK',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0x514910771af9ca656af840dff83e8264ecf986ca',
        },
        DUSD: {
          underlying: [
            '0x5bc25f649fc4e26069ddf4cf4010f9f706c23831',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x5bc25f649fc4e26069ddf4cf4010f9f706c23831',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x8038C01A0390a8c547446a0b2c18fc9aEFEcc10c',
          name: 'DUSD',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        aave: {
          underlying: [
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x028171bca77440897b824ca71d1c56cac55b68a3',
            '0xbcca60bb61934080951369a648fb03df4f96263c',
            '0x3ed3b47dd13ec9a98b44e6204a523e766b225811',
          ],
          address: '0xDeBF20617708857ebe4F679508E7b7863a8A8EeE',
          name: 'aave',
          type: 2,
          version: 3,
          isLending: true,
          isMetapool: false,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        BBTC: {
          underlying: [
            '0x9be89d2a4cd102d8fecc6bf9da793be995c22541',
            '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
            '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
            '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6',
          ],
          coins: [
            '0x9be89d2a4cd102d8fecc6bf9da793be995c22541',
            '0x075b1bb99792c9e1041ba13afef80c91a1e70fb3',
          ],
          address: '0x071c661B4DeefB59E2a3DdB20Db036821eeE8F4b',
          name: 'BBTC',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        BUSD: {
          coins: [
            '0xc2cb1040220768554cf699b0d863a3cd4324ce32',
            '0x26ea744e5b887e5205727f55dfbe8685e3b21951',
            '0xe6354ed5bc4b393a5aad09f21c46e101e692d447',
            '0x04bc0ab673d88ae9dbc9da2380cb6b79c4bca9ae',
          ],
          underlying: [
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
            '0x4fabb145d64652a948d72533023f6e7a623c7c53',
          ],
          address: '0x79a8C46DeA5aDa233ABaFFD40F3A0A2B1e5A4F27',
          name: 'BUSD',
          type: 1,
          version: 2,
          isLending: true,
          isMetapool: false,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        GUSD: {
          coins: [
            '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          underlying: [
            '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          address: '0x4f062658EaAF2C1ccf8C8e36D6824CDf41167956',
          name: 'GUSD',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        hBTC: {
          underlying: [],
          coins: [
            '0x0316eb71485b0ab14103307bf65a021042c6d380',
            '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
          ],
          address: '0x4CA9b3063Ec5866A4B82E437059D2C43d1be596F',
          name: 'hBTC',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: false,
          baseToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        hUSD: {
          underlying: [
            '0xdf574c24545e5ffecb9a659c229253d4111d87e1',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0xdf574c24545e5ffecb9a659c229253d4111d87e1',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x3eF6A01A0f81D6046290f3e2A8c5b843e738E604',
          name: 'hUSD',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        LinkUSD: {
          underlying: [
            '0x0e2ec54fc0b509f445631bf4b91ab8168230c752',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x0e2ec54fc0b509f445631bf4b91ab8168230c752',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171',
          name: 'LinkUSD',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        MUSD: {
          underlying: [
            '0xe2f2a5c287993345a840db3b0845fbc70f5935a5',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0xe2f2a5c287993345a840db3b0845fbc70f5935a5',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x8474DdbE98F5aA3179B3B3F5942D724aFcdec9f6',
          name: 'MUSD',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        oBTC: {
          underlying: [
            '0x8064d9ae6cdf087b1bcd5bdf3531bd5d8c537a68',
            '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
            '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
            '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6',
          ],
          coins: [
            '0x8064d9ae6cdf087b1bcd5bdf3531bd5d8c537a68',
            '0x075b1bb99792c9e1041ba13afef80c91a1e70fb3',
          ],
          address: '0xd81dA8D904b52208541Bade1bD6595D8a251F8dd',
          name: 'oBTC',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        pBTC: {
          underlying: [
            '0x5228a22e72ccc52d415ecfd199f99d0665e7733b',
            '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
            '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
            '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6',
          ],
          coins: [
            '0x5228a22e72ccc52d415ecfd199f99d0665e7733b',
            '0x075b1bb99792c9e1041ba13afef80c91a1e70fb3',
          ],
          address: '0x7F55DDe206dbAD629C080068923b36fe9D6bDBeF',
          name: 'pBTC',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        RSV: {
          underlying: [
            '0x196f4727526ea7fb1e17b2071b3d8eaa38486988',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x196f4727526ea7fb1e17b2071b3d8eaa38486988',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0xC18cC39da8b11dA8c3541C598eE022258F9744da',
          name: 'RSV',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        tBTC: {
          underlying: [
            '0x8daebade922df735c38c80c7ebd708af50815faa',
            '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d',
            '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
            '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6',
          ],
          coins: [
            '0x8daebade922df735c38c80c7ebd708af50815faa',
            '0x075b1bb99792c9e1041ba13afef80c91a1e70fb3',
          ],
          address: '0xC25099792E9349C7DD09759744ea681C7de2cb66',
          name: 'tBTC',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        USDK: {
          underlying: [
            '0x1c48f86ae57291f7686349f12601910bd8d470bb',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x1c48f86ae57291f7686349f12601910bd8d470bb',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x3E01dD8a5E1fb3481F0F589056b428Fc308AF0Fb',
          name: 'USDK',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        USDN: {
          underlying: [
            '0x674c6ad92fd080e4004b2312b45f796a192d27a0',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x674c6ad92fd080e4004b2312b45f796a192d27a0',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x0f9cb53Ebe405d49A0bbdBD291A65Ff571bC83e1',
          name: 'USDN',
          type: 2,
          version: 2,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        UST: {
          underlying: [
            '0xa47c8bf37f92abed4a126bda807a7b7498661acd',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0xa47c8bf37f92abed4a126bda807a7b7498661acd',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x890f4e345B1dAED0367A877a1612f86A1f86985f',
          name: 'UST',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        ANKRETH: {
          underlying: [],
          coins: [
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            '0xe95a203b1a91a908f9b9ce46459d101078c2c3cb',
          ],
          address: '0xA96A65c051bF88B4095Ee1f2451C2A9d43F53Ae2',
          name: 'ANKRETH',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        },
        BAC: {
          underlying: [
            '0x3449fc1cd036255ba1eb19d65ff4ba2b8903a69a',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x3449fc1cd036255ba1eb19d65ff4ba2b8903a69a',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x86DEc049FC430D9eB7682a044CF105A570f226Db',
          name: 'BAC',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        MIC: {
          underlying: [
            '0x368b3a58b5f49392e5c9e4c998cb0bb966752e51',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x368b3a58b5f49392e5c9e4c998cb0bb966752e51',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0xeE507b77e4a0D1782F0598C7f72440a65447b16E',
          name: 'MIC',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        USDP: {
          underlying: [
            '0x1456688345527be1f37e9e627da0837d6f08c925',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x1456688345527be1f37e9e627da0837d6f08c925',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x42d7025938bEc20B69cBae5A77421082407f053A',
          name: 'USDP',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        BUSD2: {
          underlying: [
            '0x4fabb145d64652a948d72533023f6e7a623c7c53',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x4fabb145d64652a948d72533023f6e7a623c7c53',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x4807862AA8b2bF68830e4C8dc86D0e9A998e085a',
          name: 'BUSD2',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        DOLA: {
          underlying: [
            '0x865377367054516e17014ccded1e7d814edc9ce4',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x865377367054516e17014ccded1e7d814edc9ce4',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0x9547429C0e2c3A8B88C6833B58FCE962734C0E8C',
          name: 'DOLA',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        tUSD: {
          underlying: [
            '0x0000000000085d4780b73119b644ae5ecd22b376',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x0000000000085d4780b73119b644ae5ecd22b376',
            '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
          ],
          address: '0xecd5e75afb02efa118af914515d6521aabd189f1',
          name: 'tUSD',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        RETH: {
          underlying: [],
          coins: [
            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            '0x9559aaa82d9649c7a7b220e7c461d2e74c9a3593',
          ],
          address: '0xF9440930043eb3997fc70e1339dBb11F341de7A8',
          name: 'reth',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        },
        // cyPool: {
        //   underlying: [
        //     '0x6b175474e89094c44da98b954eedeac495271d0f',
        //     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        //     '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        //   ],
        //   coins: [
        //     '0x8e595470Ed749b85C6F7669de83EAe304C2ec68F',
        //     '0x76Eb2FE28b36B3ee97F3Adae0C69606eeDB2A37c',
        //     '0x48759F220ED983dB51fA7A8C0D2AAb8f3ce4166a',
        //   ],
        //   address: '0x2dded6Da1BF5DBdF597C45fcFaa3194e53EcfeAF',
        //   name: 'cyDAI/cyUSDT/cyUSDC',
        //   type: 2,
        //   version: 3,
        //   isLending: true,
        //   isMetapool: false,
        //   baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        // },
        rai: {
          underlying: [
            '0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
          ],
          coins: [
            '0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919',
            '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
          ],
          address: '0x618788357D0EBd8A37e763ADab3bc575D54c2C7d',
          name: 'rai',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: true,
          baseToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        },
        FRAX: {
          underlying: [],
          coins: [
            '0x853d955aCEf822Db058eb8505911ED77F175b99e', // FRAX
            '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          ],
          address: '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2',
          name: 'frax',
          type: 1,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
      },
      disableFeeOnTransferTokenAddresses: new Set([
        '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', // stETH
      ]),
    },
    [Network.POLYGON]: {
      baseTokens: {
        '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': {
          // dai
          address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
          decimals: 18,
          reasonableVolume: 100000000000000000000n,
        },
        '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': {
          address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
          decimals: 8,
          reasonableVolume: 10000000n,
        },
        '0xE111178A87A3BFf0c8d18DECBa5798827539Ae99': {
          address: '0xE111178A87A3BFf0c8d18DECBa5798827539Ae99',
          decimals: 2,
          reasonableVolume: 10000n,
        },
      },
      eventSupportedPools: [],
      pools: {
        Aave: {
          underlying: [
            '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
            '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
            '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
          ],
          coins: [
            '0x27F8D03b3a2196956ED754baDc28D73be8830A6e',
            '0x1a13F4Ca1d028320A707D99520AbFefca3998b7F',
            '0x60D55F02A771d515e077c9C2403a1ef324885CeC',
          ],
          address: '0x445FE580eF8d70FF569aB36e80c647af338db351',
          name: 'aave',
          type: 2,
          version: 3,
          isLending: true,
          isMetapool: false,
          baseToken: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
        },
        Ren: {
          underlying: [
            '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
            '0xdbf31df14b66535af65aac99c32e9ea844e14501',
          ],
          coins: [
            '0x5c2ed810328349100a66b82b78a1791b101c9d61',
            '0xdbf31df14b66535af65aac99c32e9ea844e14501',
          ],
          address: '0xc2d95eef97ec6c17551d45e77b590dc1f9117c67',
          name: 'ren',
          type: 2,
          version: 3,
          isLending: true,
          isMetapool: false,
          baseToken: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
        },
      },
    },
    [Network.AVALANCHE]: {
      baseTokens: {
        '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70': {
          address: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70',
          decimals: 18,
          reasonableVolume: 1000000000000000000000n,
        },
        '0x50b7545627a5162F82A992c33b87aDc75187B218': {
          address: '0x50b7545627a5162F82A992c33b87aDc75187B218',
          decimals: 8,
          reasonableVolume: 1000000n,
        },
        '0x130966628846BFd36ff31a822705796e8cb8C18D': {
          address: '0x130966628846BFd36ff31a822705796e8cb8C18D',
          decimals: 18,
          reasonableVolume: 1000000000000000000000n,
        },
        '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664': {
          address: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
          decimals: 6,
          reasonableVolume: 100000n,
        },
      },
      eventSupportedPools: [],
      pools: {
        Aave: {
          underlying: [
            '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70',
            '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
            '0xc7198437980c041c805A1EDcbA50c1Ce5db95118',
          ],
          coins: [
            '0x47AFa96Cdc9fAb46904A55a6ad4bf6660B53c38a',
            '0x46A51127C3ce23fb7AB1DE06226147F446e4a857',
            '0x532E6537FEA298397212F09A61e03311686f548e',
          ],
          address: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
          name: 'aave',
          type: 2,
          version: 3,
          isLending: true,
          isMetapool: false,
          baseToken: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70',
        },
      },
    },
    [Network.ARBITRUM]: {
      baseTokens: {
        '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8': {
          address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
          decimals: 6,
          reasonableVolume: 100000n,
        },
        '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': {
          address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
          decimals: 8,
          reasonableVolume: 1000000n,
        },
      },
      eventSupportedPools: [],
      pools: {
        '2pool': {
          underlying: [],
          coins: [
            '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
            '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
          ],
          address: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
          name: '2pool (2CRV)',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        },
        ren: {
          underlying: [],
          coins: [
            '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
            '0xDBf31dF14B66535aF65AaC99C32e9eA844e14501',
          ],
          address: '0x3E01dD8a5E1fb3481F0F589056b428Fc308AF0Fb',
          name: 'ren (btcCRV)',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
          baseToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
        },
      },
    },
    [Network.OPTIMISM]: {
      baseTokens: {
        '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1': {
          address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
          decimals: 18,
          reasonableVolume: 1000000000000000000000n,
        },
      },
      eventSupportedPools: [],
      pools: {
        '3pool': {
          underlying: [],
          coins: [
            '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
            '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
            '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
          ],
          address: '0x1337BedC9D22ecbe766dF105c9623922A27963EC',
          name: '3pool (3CRV)',
          type: 2,
          version: 3,
          isLending: false,
          isMetapool: false,
        },
      },
    },
    [Network.GNOSIS]: {
      baseTokens: {
        '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d': {
          address: '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d',
          decimals: 18,
          reasonableVolume: 1000000000000000000000n,
        },
        '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83': {
          address: '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83',
          decimals: 6,
          reasonableVolume: 1000000000n,
        },
        '0x4ecaba5870353805a9f068101a40e0f32ed605c6': {
          address: '0x4ecaba5870353805a9f068101a40e0f32ed605c6',
          decimals: 6,
          reasonableVolume: 1000000000n,
        },
      },
      eventSupportedPools: [],
      pools: {
        '3pool': {
          underlying: [],
          coins: [
            '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
            '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
            '0x4ECaBa5870353805a9F068101A40E0f32ed605C6',
          ],
          address: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
          name: '3pool (x3CRV)',
          type: 1,
          version: 3,
          isLending: false,
          isMetapool: false,
        },
      },
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [
      {
        name: 'Adapter01',
        index: 3,
      },
    ],
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [
      // use for beltfi (deprecated)
      {
        name: 'BscAdapter01',
        index: 2,
      },
    ],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [
      {
        name: 'PolygonAdapter01',
        index: 3,
      },
    ],
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [
      {
        name: 'AvalancheAdapter01',
        index: 5,
      },
    ],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [
      {
        name: 'ArbitrumAdapter01',
        index: 6,
      },
    ],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [
      {
        name: 'OptimismAdapter01',
        index: 5,
      },
    ],
  },
};
