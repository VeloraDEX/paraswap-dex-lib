import { Address, Token } from '../src/types';
import { ETHER_ADDRESS, Network } from '../src/constants';

export const Tokens: {
  [network: number]: { [symbol: string]: Token };
} = {
  [Network.MAINNET]: {
    aEthLidowstETH: {
      address: '0xC035a7cf15375cE2706766804551791aD035E0C2',
      decimals: 18,
    },
    sUSDS: {
      address: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
      decimals: 18,
    },
    USDS: {
      address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
      decimals: 18,
    },
    SKY: {
      address: '0x56072C95FAA701256059aa122697B133aDEd9279',
      decimals: 18,
    },
    MKR: {
      address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2',
      decimals: 18,
    },
    // Pendle PT tokens for testing AaveV3PtRollOver
    'PT-sUSDe-29MAY2025': {
      address: '0xb7de5dfcb74d25c2f21841fbd6230355c50d9308',
      decimals: 18,
    },
    'PT-sUSDe-31JUL2025': {
      address: '0x3b3fb9c57858ef816833dc91565efcd85d96f634',
      decimals: 18,
    },
    'PT-eUSDe-14AUG2025': {
      address: '0x14bdc3a3ae09f5518b923b69489cbcafb238e617',
      decimals: 18,
    },
    'PT-sUSDe-25SEP2025': {
      address: '0x9f56094c450763769ba0ea9fe2876070c0fd5f77',
      decimals: 18,
    },
    'PT-USDe-31JUL2025': {
      address: '0x917459337CaAC939D41d7493B3999f571D20D667',
      decimals: 18,
    },
    'PT-USDe-25SEP2025': {
      address: '0xbc6736d346a5ebc0debc997397912cd9b8fae10a',
      decimals: 18,
    },
    AA_wstETH: {
      decimals: 18,
      address: '0x2688fc68c4eac90d9e5e1b94776cf14eade8d877',
    },
    'AA_idle_cpPOR-USDC': {
      decimals: 18,
      address: '0x9cacd44cfdf22731bc99facf3531c809d56bd4a2',
    },
    'BB_idle_cpFAS-USDT': {
      decimals: 18,
      address: '0x3eb6318b8d9f362a0e1d99f6032edb1c4c602500',
    },
    AA_steakUSDC: {
      decimals: 18,
      address: '0x2b0e31b8ee653d2077db86dea3acf3f34ae9d5d2',
    },
    BB_steakUSDC: {
      decimals: 18,
      address: '0x7b713b1cb6eafd4061064581579ffccf7df21545',
    },
    AA_Re7WETH: {
      decimals: 18,
      address: '0x454bb3cb427b21e1c052a080e21a57753cd6969e',
    },
    BB_Re7WETH: {
      decimals: 18,
      address: '0x20aa3cd83044d2903181f7ef5c2b498a017d1c4a',
    },
    BB_dUSDCV3: {
      decimals: 18,
      address: '0x2a84a042db06222c486bcb815e961f26599d0df6',
    },
    AA_sUSDe: {
      decimals: 18,
      address: '0xf3188697bd35df73e4293d04a07ebaaf1ffc4018',
    },
    BB_sUSDe: {
      decimals: 18,
      address: '0xb8d0be502a8f12cc5213733285b430a43d07349d',
    },
    AA_iETHv2: {
      decimals: 18,
      address: '0xdf17c739b666B259DA3416d01f0310a6e429f592',
    },
    BB_iETHv2: {
      decimals: 18,
      address: '0x990b3aF34dDB502715E1070CE6778d8eB3c8Ea82',
    },
    SUSDE: {
      address: '0x9d39a5de30e57443bff2a8307a4256c8797a3497',
      decimals: 18,
    },
    USDE: {
      address: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
      decimals: 18,
    },
    eUSDe: {
      address: '0x90d2af7d622ca3141efa4d8f1f24d86e5974cc8f',
      decimals: 18,
    },
    EKUBO: {
      address: '0x04C46E830Bb56ce22735d5d8Fc9CB90309317d0f',
      decimals: 18,
    },
    ETH: {
      address: ETHER_ADDRESS,
      decimals: 18,
    },
    ETHx: {
      address: '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b',
      decimals: 18,
    },
    SWETH: {
      address: '0xf951e335afb289353dc249e82926178eac7ded78',
      decimals: 18,
    },
    BAT: {
      address: '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
      decimals: 18,
    },
    rswETH: {
      address: '0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0',
      decimals: 18,
    },
    REQ: {
      address: '0x8f8221aFbB33998d8584A2B05749bA73c37a938a',
      decimals: 18,
    },
    eETH: {
      address: '0x35fA164735182de50811E8e2E824cFb9B6118ac2',
      decimals: 18,
    },
    weETH: {
      address: '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee',
      decimals: 18,
    },
    AMPL: {
      address: '0xd46ba6d942050d489dbd938a2c909a5d5039a161',
      decimals: 9,
    },
    USDC: {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      decimals: 6,
      symbol: 'USDC',
    },
    INST: {
      address: '0x6f40d4A6237C257fff2dB00FA0510DeEECd303eb',
      decimals: 18,
    },
    aEthUSDC: {
      address: '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c',
      decimals: 6,
    },
    aEthWETH: {
      address: '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8',
      decimals: 18,
    },
    MAV: {
      address: '0x7448c7456a97769f6cd04f1e83a4a23ccdc46abd',
      decimals: 18,
    },
    SUSHI: {
      address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2',
      decimals: 18,
    },
    CUSDC: {
      address: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
      decimals: 8,
    },
    TUSD: {
      address: '0x0000000000085d4780b73119b644ae5ecd22b376',
      decimals: 18,
    },
    WBTC: {
      address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      decimals: 8,
    },
    sBTC: {
      address: '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6',
      decimals: 18,
    },
    tBTCv2: {
      address: '0x18084fbA666a33d37592fA2633fD49a74DD93a88',
      decimals: 18,
    },
    BADGER: {
      address: '0x3472A5A71965499acd81997a54BBA8D852C6E53d',
      decimals: 18,
    },
    USDT: {
      address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      decimals: 6,
    },
    STETH: {
      address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
      decimals: 18,
    },
    SDEX: {
      address: '0x5DE8ab7E27f6E7A1fFf3E5B337584Aa43961BEeF',
      decimals: 18,
    },
    wstETH: {
      address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      decimals: 18,
    },
    USDM: {
      address: '0x59d9356e565ab3a36dd77763fc0d87feaf85508c',
      decimals: 18,
    },
    wUSDM: {
      address: '0x57f5e098cad7a3d1eed53991d4d66c45c9af7812',
      decimals: 18,
    },
    frxETH: {
      address: '0x5E8422345238F34275888049021821E8E08CAa1f',
      decimals: 18,
    },
    WETH: {
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      decimals: 18,
    },
    PSP: {
      address: '0xcafe001067cdef266afb7eb5a286dcfd277f3de5',
      decimals: 18,
    },
    SETH: {
      address: '0x5e74C9036fb86BD7eCdcb084a0673EFc32eA31cb',
      decimals: 18,
    },
    LINK: {
      address: '0x514910771af9ca656af840dff83e8264ecf986ca',
      decimals: 18,
    },
    DAI: {
      address: '0x6b175474e89094c44da98b954eedeac495271d0f',
      decimals: 18,
    },
    MLN: {
      address: '0xec67005c4e498ec7f55e092bd1d35cbc47c91892',
      decimals: 18,
    },
    SENT: {
      address: '0xa44E5137293E855B1b7bC7E2C6f8cD796fFCB037',
      decimals: 8,
    },
    oldFRAX: {
      address: '0x853d955acef822db058eb8505911ed77f175b99e',
      decimals: 18,
    },
    aDAI: {
      address: '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
      decimals: 18,
    },
    aUSDT: {
      address: '0x3Ed3B47Dd13ECAURA9a98b44e6204A523E766B225811',
      decimals: 6,
    },
    waUSDT: {
      address: '0xf8Fd466F12e236f4c96F7Cce6c79EAdB819abF58',
      decimals: 6,
    },
    ALUSD: {
      address: '0xbc6da0fe9ad5f3b0d58160288917aa56653660e9',
      decimals: 18,
    },
    BAL: {
      address: '0xba100000625a3754423978a60c9317c58a424e3D',
      decimals: 18,
    },
    OHM: {
      address: '0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5',
      decimals: 9,
    },
    AURA: {
      address: '0xc0c293ce456ff0ed870add98a0828dd4d2903dbf',
      decimals: 18,
    },
    WISE: {
      address: '0x66a0f676479cee1d7373f3dc2e2952778bff5bd6',
      decimals: 18,
    },
    DDIM: {
      address: '0xFbEEa1C75E4c4465CB2FCCc9c6d6afe984558E20',
      decimals: 18,
    },
    DODO: {
      address: '0x43Dfc4159D86F3A37A5A4B3D4580b888ad7d4DDd',
      decimals: 18,
    },
    STG: {
      address: '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6',
      decimals: 18,
    },
    ADAI: {
      address: '0x028171bca77440897b824ca71d1c56cac55b68a3',
      decimals: 18,
    },
    AWETH: {
      address: '0x030ba81f1c18d280636f32af80b9aad02cf0854e',
      decimals: 18,
    },
    ALPHA: {
      address: '0xa1faa113cbe53436df28ff0aee54275c13b40975',
      decimals: 18,
    },
    CRV: {
      address: '0xd533a949740bb3306d119cc777fa900ba034cd52',
      decimals: 18,
    },
    INCH: {
      address: '0x111111111117dC0aa78b770fA6A738034120C302',
      decimals: 18,
    },
    mUSD: {
      address: '0xe2f2a5c287993345a840db3b0845fbc70f5935a5',
      decimals: 18,
    },
    mBTC: {
      address: '0x945facb997494cc2570096c74b5f66a3507330a1',
      decimals: 18,
    },
    renBTC: {
      address: '0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D',
      decimals: 8,
    },
    HBTC: {
      address: '0x0316EB71485b0Ab14103307bf65a021042c6d380',
      decimals: 18,
    },
    tBTC: {
      address: '0x8dAEBADE922dF735c38C80C7eBD708Af50815fAa',
      decimals: 18,
    },
    BUSD: {
      address: '0x4fabb145d64652a948d72533023f6e7a623c7c53',
      decimals: 18,
    },
    GUSD: {
      address: '0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
      decimals: 2,
    },
    ADAIv1: {
      address: '0xfC1E690f61EFd961294b3e1Ce3313fBD8aa4f85d',
      decimals: 18,
    },
    CETH: {
      address: '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5',
      decimals: 8,
    },
    CDAI: {
      address: '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      decimals: 8,
    },
    MIM: {
      address: '0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3',
      decimals: 18,
    },
    AnkETH: {
      address: '0xE95A203B1a91a908F9B9CE46459d101078c2c3cb',
      decimals: 18,
    },
    EURS: {
      address: '0xdB25f211AB05b1c97D595516F45794528a807ad8',
      decimals: 2,
    },
    EURT: {
      address: '0xC581b735A1688071A1746c968e0798D642EDE491',
      decimals: 6,
    },
    jEUR: {
      address: '0x0f17bc9a994b87b5225cfb6a2cd4d667adb4f20b',
      decimals: 18,
    },
    jCHF: {
      address: '0x53dfea0a8cc2a2a2e425e1c174bc162999723ea0',
      decimals: 18,
    },
    jGBP: {
      address: '0x7409856cae628f5d578b285b45669b36e7005283',
      decimals: 18,
    },
    XAUT: {
      address: '0x68749665FF8D2d112Fa859AA293F07A622782F38',
      decimals: 6,
    },
    CVX: {
      address: '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B',
      decimals: 18,
    },
    UST: {
      address: '0xa47c8bf37f92abed4a126bda807a7b7498661acd',
      decimals: 18,
    },
    SAITAMA: {
      address: '0x8b3192f5eebd8579568a2ed41e6feb402f93f73f',
      decimals: 9,
    },
    BBAUSDT: {
      // bpt of USDT Linear Pool
      address: '0x2bbf681cc4eb09218bee85ea2a5d3d13fa40fc0c',
      decimals: 18,
    },
    BBADAI: {
      // bpt of DAI Linear Pool
      address: '0x804cdb9116a10bb78768d3252355a1b18067bf8f',
      decimals: 18,
    },
    BBAUSD: {
      address: '0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb2',
      decimals: 18,
    },
    BBFDAI: {
      address: '0x8f4063446f5011bc1c9f79a819efe87776f23704',
      decimals: 18,
    },
    FEI: {
      address: '0x956F47F50A910163D8BF957Cf5846D573E7f87CA',
      decimals: 18,
    },
    newFRAX: {
      address: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
      decimals: 18,
    },
    sETH: {
      address: '0x5e74C9036fb86BD7eCdcb084a0673EFc32eA31cb',
      decimals: 18,
    },
    sUSD: {
      address: '0x57Ab1ec28D129707052df4dF418D58a2D46d5f51',
      decimals: 18,
    },
    USDD: {
      address: '0x0c10bf8fcb7bf5412187a595ab97a3609160b5c6',
      decimals: 18,
    },
    alETH: {
      address: '0x0100546f2cd4c9d97f798ffc9755e47865ff7ee6',
      decimals: 18,
    },
    SHIBA: {
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      decimals: 18,
    },
    dUSDC: {
      address: '0xc411db5f5eb3f7d552f9b8454b2d74097ccde6e3',
      decimals: 6,
    },
    EURA: {
      address: '0x1a7e4e63778b4f12a199c062f3efdd288afcbce8',
      decimals: 18,
      symbol: 'EURA',
    },
    FLUID: {
      address: '0x6f40d4A6237C257fff2dB00FA0510DeEECd303eb',
      decimals: 18,
    },
    EUROC: {
      address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
      decimals: 6,
      symbol: 'EUROC',
    },
    bERNX: {
      address: '0x3f95AA88dDbB7D9D484aa3D482bf0a80009c52c9',
      decimals: 18,
      symbol: 'bERNX',
    },
    bC3M: {
      address: '0x2F123cF3F37CE3328CC9B5b8415f9EC5109b45e7',
      decimals: 18,
      symbol: 'bC3M',
    },
    stEUR: {
      address: '0x004626a008b1acdc4c74ab51644093b155e59a23',
      decimals: 18,
    },
    USDA: {
      address: '0x0000206329b97DB379d5E1Bf586BbDB969C63274',
      decimals: 18,
      symbol: 'USDA',
    },
    bIB01: {
      address: '0xCA30c93B02514f86d5C86a6e375E3A330B435Fb5',
      decimals: 18,
      symbol: 'bIB01',
    },
    steakUSDC: {
      address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
      decimals: 18,
      symbol: 'steakUSDC',
    },
    stUSD: {
      address: '0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776',
      decimals: 18,
    },
    GHO: {
      address: '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f',
      decimals: 18,
    },
    stkGHO: {
      address: '0x1a88Df1cFe15Af22B3c4c783D4e6F7F9e0C1885d',
      decimals: 18,
    },
    USDe: {
      address: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3',
      decimals: 18,
    },
    crvUSD: {
      address: '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E',
      decimals: 18,
    },
    wibBTC: {
      address: '0x8751d4196027d4e6da63716fa7786b5174f04c15',
      decimals: 18,
    },
    MATIC: {
      address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0',
      decimals: 18,
    },
    POL: {
      address: '0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6',
      decimals: 19,
    },
    GYD: {
      address: '0xe07f9d810a48ab5c3c914ba3ca53af14e4491e8a',
      decimals: 18,
    },
    LUSD: {
      address: '0x5f98805a4e8be255a32880fdec7f6728c6568ba0',
      decimals: 18,
    },
    BNT: {
      address: '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c',
      decimals: 18,
    },
    sDAI: {
      address: '0x83f20f44975d03b1b09e64809b757c47f942beea',
      decimals: 18,
    },
    stataUSDT: {
      address: '0x862c57d48becb45583aeba3f489696d22466ca1b',
      decimals: 6,
    },
    waEthUSDT: {
      address: '0x7Bc3485026Ac48b6cf9BaF0A377477Fff5703Af8',
      decimals: 6,
    },
    waEthUSDC: {
      address: '0xD4fa2D31b7968E448877f69A96DE69f5de8cD23E',
      decimals: 6,
    },
    aaveUSDT: {
      address: '0x23878914efe38d27c4d67ab83ed1b93a74d4086a',
      decimals: 6,
    },
    rUSD: {
      address: '0x65D72AA8DA931F047169112fcf34f52DbaAE7D18',
      decimals: 18,
    },
    arUSD: {
      address: '0x07D1718fF05a8C53C8F05aDAEd57C0d672945f9a',
      decimals: 18,
    },
    USD0: {
      address: '0x73A15FeD60Bf67631dC6cd7Bc5B6e8da8190aCF5',
      decimals: 18,
      symbol: 'USD0',
    },
    'USD0++': {
      address: '0x35D8949372D46B7a3D5A56006AE77B215fc69bC0',
      decimals: 18,
      symbol: 'USD0++',
    },
    wUSDL: {
      address: '0x7751e2f4b8ae93ef6b79d86419d42fe3295a4559',
      decimals: 18,
      symbol: 'wUSDL',
    },
    USDL: {
      address: '0xbdC7c08592Ee4aa51D06C27Ee23D5087D65aDbcD',
      decimals: 18,
      symbol: 'USDL',
    },
    M: {
      address: '0x866A2BF4E572CbcF37D5071A7a58503Bfb36be1b',
      decimals: 6,
      symbol: 'M',
    },
    WrappedM: {
      address: '0x437cc33344a0B27A429f795ff6B469C72698B291',
      decimals: 6,
      symbol: 'wM',
    },
    UsualM: {
      address: '0x4cbc25559dbbd1272ec5b64c7b5f48a2405e6470',
      decimals: 6,
      symbol: 'USUALM',
    },
    stataEthWETH: {
      address: '0x252231882FB38481497f3C767469106297c8d93b',
      decimals: 18,
    },
    waEthWETH: {
      address: '0x0bfc9d54Fc184518A81162F8fB99c2eACa081202',
      decimals: 18,
    },
    cbBTC: {
      address: `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf`,
      decimals: 8,
    },
    RLUSD: {
      address: '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD',
      decimals: 18,
    },
    baoBTC: {
      address: '0x22d76e6e1d9ab4072522c1bc60c85a0d5626ca2d',
      decimals: 18,
    },
    BUNNI: {
      address: '0x000000c396558ffbab5ea628f39658bdf61345b3',
      decimals: 18,
    },
    USR: {
      address: '0x66a1e37c9b0eaddca17d3662d6c05f4decf3e110',
      decimals: 18,
    },
    USDP: {
      address: '0x8e870d67f660d95d5be530380d0ec0bd388289e1',
      decimals: 18,
    },
  },
  [Network.POLYGON]: {
    jGBP: {
      address: '0x767058f11800fba6a682e73a6e79ec5eb74fac8c',
      decimals: 18,
    },
    DAI: {
      address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      decimals: 18,
    },
    // native bridged wormhole
    USDCe: {
      address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
      decimals: 6,
    },
    MLN: {
      address: '0xa9f37d84c856fda3812ad0519dad44fa0a3fe207',
      decimals: 11,
    },
    TEL: {
      address: '0xdf7837de1f2fa4631d716cf2502f8b230f1dcc32',
      decimals: 2,
    },
    // wormhole
    USDC: {
      address: '0x576Cf361711cd940CD9C397BB98C4C896cBd38De',
      decimals: 6,
    },
    // circle issued usdc
    USDCn: {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      decimals: 6,
    },
    stataUSDCn: {
      address: '0x2dCa80061632f3F87c9cA28364d1d0c30cD79a19',
      decimals: 6,
    },
    aaveUSDCn: {
      address: '0xa4d94019934d8333ef880abffbf2fdd611c762bd',
      decimals: 6,
    },
    POPS: {
      address: '0xa92A1576D11dB45c53be71d59245ac97ce0d8147',
      decimals: 18,
    },
    CRV: {
      address: '0x172370d5cd63279efa6d502dab29171933a610af',
      decimals: 18,
    },
    BAL: {
      address: '0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3',
      decimals: 18,
    },
    AAVE: {
      address: '0xd6df932a45c0f255f85145f286ea0b292b21c90b',
      decimals: 18,
    },
    PSP: {
      address: '0x42d61d766b85431666b39b89c43011f24451bff6',
      decimals: 18,
    },
    WETH: {
      address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
      decimals: 18,
    },
    crvUSD: {
      address: '0xc4ce1d6f5d98d65ee25cf85e9f2e9dcfee6cb5d6',
      decimals: 18,
    },
    WMATIC: {
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      decimals: 18,
    },
    AMWMATIC: {
      address: '0x8dF3aad3a84da6b69A4DA8aeC3eA40d9091B2Ac4',
      decimals: 18,
    },
    aPolWMATIC: {
      address: '0x6d80113e533a2c0fe82eabd35f1875dcea89ea97',
      decimals: 18,
    },
    MUST: {
      address: '0x9C78EE466D6Cb57A4d01Fd887D2b5dFb2D46288f',
      decimals: 18,
    },
    WOLF: {
      address: '0x8f18dC399594b451EdA8c5da02d0563c0b2d0f16',
      decimals: 9,
    },
    AMDAI: {
      address: '0x27F8D03b3a2196956ED754baDc28D73be8830A6e',
      decimals: 18,
    },
    BTU: {
      address: '0xfdc26cda2d2440d0e83cd1dee8e8be48405806dc',
      decimals: 18,
    },
    USDT: {
      address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      decimals: 6,
    },
    WBTC: {
      address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
      decimals: 8,
    },
    MATIC: { address: ETHER_ADDRESS, decimals: 18 },
    mUSD: {
      address: '0xe840b73e5287865eec17d250bfb1536704b43b21',
      decimals: 18,
    },
    AMWETH: {
      address: '0x28424507fefb6f7f8e9d3860f56504e4e5f5f390',
      decimals: 18,
    },
    AMWBTC: {
      address: '0x5c2ed810328349100a66b82b78a1791b101c9d61',
      decimals: 8,
    },
    KNC: {
      address: '0x1c954e8fe737f99f68fa1ccda3e51ebdb291948c',
      decimals: 18,
    },
    jEUR: {
      address: '0x4e3decbb3645551b8a19f0ea1678079fcb33fb4c',
      decimals: 18,
    },
    jGPB: {
      address: '0x767058f11800fba6a682e73a6e79ec5eb74fac8c',
      decimals: 18,
    },
    jCHF: {
      address: '0xbd1463f02f61676d53fd183c2b19282bff93d099',
      decimals: 18,
    },
    RADIO: {
      address: '0x613a489785C95afEB3b404CC41565cCff107B6E0',
      decimals: 18,
    },
    HANZO: {
      address: '0x37eb60f78e06c4bb2a5f836b0fc6bccbbaa995b3',
      decimals: 9,
    },
    RVLT: {
      address: '0xf0f9d895aca5c8678f706fb8216fa22957685a13',
      decimals: 18,
    },
    stMATIC: {
      address: '0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4',
      decimals: 18,
    },
    axlUSDC: {
      address: '0x750e4c4984a9e0f12978ea6742bc1c5d248f40ed',
      decimals: 6,
    },
    deUSDC: {
      address: '0x1ddcaa4ed761428ae348befc6718bcb12e63bfaa',
      decimals: 6,
    },
    amUSDT: {
      address: '0x60d55f02a771d515e077c9c2403a1ef324885cec',
      decimals: 6,
    },
    amUSDC: {
      address: '0x1a13F4Ca1d028320A707D99520AbFefca3998b7F',
      decimals: 6,
    },
    MAI: {
      address: '0xa3fa99a148fa48d14ed51d610c367c61876997f1',
      decimals: 18,
    },
    EURA: {
      address: '0xe0b52e49357fd4daf2c15e02058dce6bc0057db4',
      decimals: 18,
      symbol: 'EURA',
    },
    USDM: {
      address: '0x59d9356e565ab3a36dd77763fc0d87feaf85508c',
      decimals: 18,
    },
    wUSDM: {
      address: '0x57f5e098cad7a3d1eed53991d4d66c45c9af7812',
      decimals: 18,
    },
    stEUR: {
      address: '0x004626a008b1acdc4c74ab51644093b155e59a23',
      decimals: 18,
    },
    USDA: {
      address: '0x0000206329b97DB379d5E1Bf586BbDB969C63274',
      decimals: 18,
      symbol: 'USDA',
    },
    stUSD: {
      address: '0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776',
      decimals: 18,
    },
    BUSD: {
      address: '0x9C9e5fD8bbc25984B178FdCE6117Defa39d2db39',
      decimals: 18,
    },
    TUSD: {
      address: '0x2e1ad108ff1d8c782fcbbb89aad783ac49586756',
      decimals: 18,
    },
    SDEX: {
      address: '0x6899fAcE15c14348E1759371049ab64A3a06bFA6',
      decimals: 18,
    },
    MATICX: {
      address: '0xfa68fb4628dff1028cfec22b4162fccd0d45efb6',
      decimals: 18,
    },
    SUSHI: {
      address: '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a',
      decimals: 18,
    },
    TRYB: {
      address: '0x4fb71290ac171e1d144f7221d882becac7196eb5',
      decimals: 6,
    },
  },
  [Network.SONIC]: {
    S: { address: ETHER_ADDRESS, decimals: 18 },
    WS: {
      address: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
      decimals: 18,
    },
    USDCe: {
      address: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
      decimals: 6,
    },
    WETH: {
      address: '0x50c42dEAcD8Fc9773493ED674b675bE577f2634b',
      decimals: 18,
    },
    USDT: {
      address: '0x6047828dc181963ba44974801ff68e538da5eaf9',
      decimals: 6,
    },
    stS: {
      address: '0xE5DA20F15420aD15DE0fa650600aFc998bbE3955',
      decimals: 18,
    },
    aSonwS: {
      address: '0x6C5E14A212c1C3e4Baf6f871ac9B1a969918c131',
      decimals: 18,
    },
    aSonUSDC: {
      address: '0x578Ee1ca3a8E1b54554Da1Bf7C583506C4CD11c6',
      decimals: 18,
    },
    waSonUSDC: {
      address: '0x6646248971427B80ce531bdD793e2Eb859347E55',
      decimals: 18,
    },
    waSonwS: {
      address: '0x18b7b8695165290f2767bc63c36d3dfea4c0f9bb',
      decimals: 18,
    },
    BOO: {
      address: '0x7a0c53f7eb34c5bc8b01691723669ada9d6cb384',
      decimals: 18,
    },
    WAGMI: {
      address: '0x0e0Ce4D450c705F8a0B6Dd9d5123e3df2787D16B',
      decimals: 18,
    },
    beS: {
      address: '0x871a101dcf22fe4fe37be7b654098c801cba1c88',
      decimals: 18,
    },
    anS: {
      address: '0x0c4e186eae8acaa7f7de1315d5ad174be39ec987',
      decimals: 18,
    },
    SiloWS: {
      address: '0x016c306e103fbf48ec24810d078c65ad13c5f11b',
      decimals: 18,
    },
    SHADOW: {
      address: '0x3333b97138d4b086720b5ae8a7844b1345a33333',
      decimals: 18,
    },
    BEETS: {
      address: '0x2d0e0814e62d80056181f5cd932274405966e4f0',
      decimals: 18,
    },
  },
  [Network.BSC]: {
    POPS: {
      address: '0xa1051433EC7b5cc249c75Fdd5b96BF423f2f4A32',
      decimals: 18,
    },
    DAI: {
      address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
      decimals: 18,
    },
    WBNB: {
      address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
      decimals: 18,
    },
    BNBx: {
      address: '0x1bdd3Cf7F79cfB8EdbB955f20ad99211551BA275',
      decimals: 18,
    },
    BUSD: {
      address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
      decimals: 18,
    },
    USDT: {
      address: '0x55d398326f99059ff775485246999027b3197955',
      decimals: 18,
    },
    ETH: {
      address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
      decimals: 18,
    },
    UST: {
      address: '0x23396cf899ca06c4472205fc903bdb4de249d6fc',
      decimals: 18,
    },
    USDC: {
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      decimals: 18,
    },
    RADIO: {
      address: '0x30807D3b851A31d62415B8bb7Af7dCa59390434a',
      decimals: 18,
    },
    BNB: { address: ETHER_ADDRESS, decimals: 18 },
    bBTC: {
      address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
      decimals: 18,
    },
    anyBTC: {
      address: '0x54261774905f3e6E9718f2ABb10ed6555cae308a',
      decimals: 8,
    },
    nUSD: {
      address: '0x23b891e5C62E0955ae2bD185990103928Ab817b3',
      decimals: 18,
    },
    CONE: {
      address: '0xA60205802E1B5C6EC1CAFA3cAcd49dFeECe05AC9',
      decimals: 18,
    },
    axlUSD: {
      address: '0x4268B8F0B87b6Eae5d897996E6b845ddbD99Adf3',
      decimals: 6,
    },
    FRAX: {
      address: '0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40',
      decimals: 18,
    },
    frxETH: {
      address: '0x64048A7eEcF3a2F1BA9e144aAc3D7dB6e58F555e',
      decimals: 18,
    },
    USDFI: {
      address: '0x11A38e06699b238D6D9A0C7A01f3AC63a07ad318',
      decimals: 18,
    },
    XRP: {
      address: '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe',
      decimals: 18,
    },
    SDEX: {
      address: '0xFdc66A08B0d0Dc44c17bbd471B88f49F50CdD20F',
      decimals: 18,
    },
    EURA: {
      address: '0x12f31B73D812C6Bb0d735a218c086d44D5fe5f89',
      decimals: 18,
      symbol: 'EURA',
    },
    USDA: {
      address: '0x0000206329b97DB379d5E1Bf586BbDB969C63274',
      decimals: 18,
      symbol: 'USDA',
    },
    stUSD: {
      address: '0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776',
      decimals: 18,
    },
    stataUSDT: {
      address: '0x0471d185cc7be61e154277cab2396cd397663da6',
      decimals: 18,
    },
    aaveUSDT: {
      address: '0xa9251ca9de909cb71783723713b21e4233fbf1b1',
      decimals: 18,
    },
  },
  [Network.AVALANCHE]: {
    LINKe: {
      address: '0x5947bb275c521040051d82396192181b413227a3',
      decimals: 18,
    },
    PHAR: {
      address: '0xAAAB9D12A30504559b0C5a9A5977fEE4A6081c6b',
      decimals: 18,
    },
    USDCe: {
      address: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
      decimals: 6,
    },
    USDC: {
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      decimals: 6,
    },
    USDTe: {
      address: '0xc7198437980c041c805A1EDcbA50c1Ce5db95118',
      decimals: 6,
    },
    USDT: {
      address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
      decimals: 6,
    },
    POPS: {
      address: '0x240248628B7B6850352764C5dFa50D1592A033A8',
      decimals: 18,
    },
    WAVAX: {
      address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      decimals: 18,
    },
    sAVAX: {
      address: '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE',
      decimals: 18,
    },
    WETHe: {
      address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
      decimals: 18,
    },
    ETH: {
      address: '0xf20d962a6c8f70c731bd838a3a388D7d48fA6e15',
      decimals: 18,
    },
    WBTC: {
      address: '0x408D4cD0ADb7ceBd1F1A1C33A0Ba2098E1295bAB',
      decimals: 8,
    },
    WETH: {
      address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
      decimals: 18,
    },
    TUSD: {
      address: '0x1c20e891bab6b1727d14da358fae2984ed9b59eb',
      decimals: 18,
    },
    oldFRAX: {
      address: '0xdc42728b0ea910349ed3c6e1c9dc06b5fb591f98',
      decimals: 18,
    },
    newFRAX: {
      address: '0xd24c2ad096400b6fbcd2ad8b24e7acbc21a1da64',
      decimals: 18,
    },
    DAIE: {
      address: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70',
      decimals: 18,
    },
    PNG: {
      address: '0x60781c2586d68229fde47564546784ab3faca982',
      decimals: 18,
    },
    SHIBX: {
      address: '0x440aBbf18c54b2782A4917b80a1746d3A2c2Cce1',
      decimals: 18,
    },
    wBTC: {
      address: '0x50b7545627a5162F82A992c33b87aDc75187B218',
      decimals: 8,
    },
    renBTC: {
      address: '0xDBf31dF14B66535aF65AaC99C32e9eA844e14501',
      decimals: 8,
    },
    BTCb: {
      address: '0x152b9d0FdC40C096757F570A51E494bd4b943E50',
      decimals: 8,
    },
    ADAI: {
      address: '0x47AFa96Cdc9fAb46904A55a6ad4bf6660B53c38a',
      decimals: 18,
    },
    avWAVAX: {
      address: '0xDFE521292EcE2A4f44242efBcD66Bc594CA9714B',
      decimals: 18,
    },
    MIM: {
      address: '0x130966628846BFd36ff31a822705796e8cb8C18D',
      decimals: 18,
    },
    TSD: {
      address: '0x4fbf0429599460D327BD5F55625E30E4fC066095',
      decimals: 18,
    },
    avUSDT: {
      address: '0x532e6537fea298397212f09a61e03311686f548e',
      decimals: 6,
    },
    THO: {
      address: '0xAE4AA155D2987B454C29450ef4f862CF00907B61',
      decimals: 18,
    },
    AVAX: { address: ETHER_ADDRESS, decimals: 18 },
    aETH: {
      address: '0x3a3A65aAb0dd2A17E3F1947bA16138cd37d08c04',
      decimals: 18,
    },
    aUSDT: {
      address: '0x71fc860f7d3a592a4a98740e39db31d25db65ae8',
      decimals: 6,
    },
    YUSD: {
      address: '0x111111111111ed1D73f860F57b2798b683f2d325',
      decimals: 18,
    },
    H2O: {
      address: '0x026187BdbC6b751003517bcb30Ac7817D5B766f8',
      decimals: 18,
    },
    MONEY: {
      address: '0x0f577433Bf59560Ef2a79c124E9Ff99fCa258948',
      decimals: 18,
    },
    nETH: {
      address: '0x19E1ae0eE35c0404f835521146206595d37981ae',
      decimals: 18,
    },
    avWETH: {
      address: '0x53f7c5869a859F0AeC3D334ee8B4Cf01E3492f21',
      decimals: 18,
    },
    nUSD: {
      address: '0xCFc37A6AB183dd4aED08C204D1c2773c0b1BDf46',
      decimals: 18,
    },
    BETS: {
      address: '0x94025780a1ab58868d9b2dbbb775f44b32e8e6e5',
      decimals: 18,
    },
    HATCHY: {
      address: '0x502580fc390606b47fc3b741d6d49909383c28a9',
      decimals: 18,
    },
    AMPL: {
      address: '0x027dbcA046ca156De9622cD1e2D907d375e53aa7',
      decimals: 9,
    },
    stataUSDT: {
      address: '0x5525ee69bc1e354b356864187de486fab5ad67d7',
      decimals: 6,
    },
    aaveUSDT: {
      address: '0x6ab707aca953edaefbc4fd23ba73294241490620',
      decimals: 6,
    },
    ARENA: {
      address: '0xB8d7710f7d8349A506b75dD184F05777c82dAd0C',
      decimals: 18,
    },
    TRYB: {
      address: '0x564a341df6c126f90cf3ecb92120fd7190acb401',
      decimals: 6,
    },
  },
  [Network.ARBITRUM]: {
    SEN: {
      address: '0x154388a4650D63acC823e06Ef9e47C1eDdD3cBb2',
      decimals: 18,
    },
    BAL: {
      address: '0x040d1edc9569d4bab2d15287dc5a4f10f56a56b8',
      decimals: 18,
    },
    DAI: {
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      decimals: 18,
    },
    ARB: {
      address: '0x912ce59144191c1204e64559fe8253a0e49e6548',
      decimals: 18,
    },
    WETH: {
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      decimals: 18,
    },
    waArbWETH: {
      address: '0x4ce13a79f45c1be00bdabd38b764ac28c082704e',
      decimals: 18,
    },
    waArbUSDCn: {
      address: '0x7F6501d3B98eE91f9b9535E4b0ac710Fb0f9e0bc',
      decimals: 6,
    },
    ETH: { address: ETHER_ADDRESS, decimals: 18 },
    USDCe: {
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      decimals: 6,
    },
    USDC: {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      decimals: 6,
      symbol: 'USDC',
    },
    SUSHI: {
      address: '0xd4d42F0b6DEF4CE0383636770eF773390d85c61A',
      decimals: 18,
    },
    crvUSD: {
      address: '0x498bf2b1e120fed3ad3d42ea2165e9b73f99c1e5',
      decimals: 18,
    },
    OHM: {
      address: '0xf0cb2dc0db5e6c66b9a70ac27b06b878da017028',
      decimals: 9,
    },
    RDNT: {
      address: '0x3082cc23568ea640225c2467653db90e9250aaa0',
      decimals: 18,
    },
    USDT: {
      address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
      decimals: 6,
    },
    USDai: {
      address: '0x0a1a1a107e45b7ced86833863f482bc5f4ed82ef',
      decimals: 18,
    },
    waArbUSDT: {
      address: '0xa6D12574eFB239FC1D2099732bd8b5dC6306897F',
      decimals: 6,
    },
    FRAX: {
      address: '0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F',
      decimals: 18,
    },
    nUSD: {
      address: '0x2913E812Cf0dcCA30FB28E6Cac3d2DCFF4497688',
      decimals: 18,
    },
    nETH: {
      address: '0x3ea9B0ab55F34Fb188824Ee288CeaEfC63cf908e',
      decimals: 18,
    },
    EURS: {
      address: '0xd22a58f79e9481d1a88e00c343885a588b34b68b',
      decimals: 2,
    },
    AAVE: {
      address: '0xba5ddd1f9d7f570dc94a51479a000e3bce967196',
      decimals: 18,
    },
    ZRO: {
      address: '0x6985884c4392d348587b19cb9eaaf157f13271cd',
      decimals: 18,
    },
    MIM: {
      address: '0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A',
      decimals: 18,
    },
    VST: {
      address: '0x64343594ab9b56e99087bfa6f2335db24c2d1f17',
      decimals: 18,
    },
    POPS: {
      address: '0xa0b20DecBc557E3f68E140eD5a0c69bc865F865A',
      decimals: 18,
    },
    ZYB: {
      address: '0x3B475F6f2f41853706afc9Fa6a6b8C5dF1a2724c',
      decimals: 18,
    },
    WBTC: {
      address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f',
      decimals: 8,
    },
    LEX: {
      address: '0x6bB7A17AcC227fd1F6781D1EEDEAE01B42047eE0',
      decimals: 18,
    },
    EURA: {
      address: '0xfa5ed56a203466cbbc2430a43c66b9d8723528e7',
      decimals: 18,
      symbol: 'EURA',
    },
    stEUR: {
      address: '0x004626a008b1acdc4c74ab51644093b155e59a23',
      decimals: 18,
    },
    USDA: {
      address: '0x0000206329b97DB379d5E1Bf586BbDB969C63274',
      decimals: 18,
      symbol: 'USDA',
    },
    USDM: {
      address: '0x59d9356e565ab3a36dd77763fc0d87feaf85508c',
      decimals: 18,
    },
    wUSDM: {
      address: '0x57f5e098cad7a3d1eed53991d4d66c45c9af7812',
      decimals: 18,
    },
    stUSD: {
      address: '0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776',
      decimals: 18,
    },
    GRAIL: {
      address: '0x3d9907f9a368ad0a51be60f7da3b97cf940982d8',
      decimals: 18,
    },
    AURY: {
      address: '0x11bf4f05eb28b802ed3ab672594decb20ffe2313',
      decimals: 9,
    },
    wstETH: {
      address: '0x5979D7b546E38E414F7E9822514be443A4800529',
      decimals: 18,
    },
    weETH: {
      address: '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe',
      decimals: 18,
    },
    RDPX: {
      address: '0x32eb7902d4134bf98a28b963d26de779af92a212',
      decimals: 18,
    },
    SDEX: {
      address: '0xabD587f2607542723b17f14d00d99b987C29b074',
      decimals: 18,
    },
    LINK: {
      address: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4',
      decimals: 18,
    },
    DMT: {
      address: '0x8b0e6f19ee57089f7649a455d89d7bc6314d04e8',
      decimals: 18,
    },
    PENDLE: {
      address: '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8',
      decimals: 18,
    },
    stataUSDT: {
      address: '0xb165a74407fe1e519d6bcbdec1ed3202b35a4140',
      decimals: 6,
    },
    aaveUSDT: {
      address: '0x6ab707aca953edaefbc4fd23ba73294241490620',
      decimals: 6,
    },
    GHO: {
      address: '0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33',
      decimals: 18,
    },
    waArbwstETH: {
      address: '0xe98fc055c99decd8da0c111b090885d5d15c774e',
      decimals: 18,
    },
    eBTC: {
      address: '0x657e8c867d8b37dcc18fa4caead9c45eb088c642',
      decimals: 8,
    },
    USDS: {
      address: '0x6491c05A82219b8D1479057361ff1654749b876b',
      decimals: 18,
    },
    sUSDS: {
      address: '0xdDb46999F8891663a8F2828d25298f70416d7610',
      decimals: 18,
    },
    BUNNI: {
      address: '0x000000c396558ffbab5ea628f39658bdf61345b3',
      decimals: 18,
    },
    BOLD: {
      address: '0x03569CC076654F82679C4BA2124D64774781B01D',
      decimals: 18,
    },
    USND: {
      address: '0x4ecf61a6c2FaB8A047CEB3B3B263B401763e9D49',
      decimals: 18,
    },
    SILO: {
      address: '0x0341c0c0ec423328621788d4854119b97f44e391',
      decimals: 18,
    },
  },
  [Network.OPTIMISM]: {
    DAI: {
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      decimals: 18,
    },
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      decimals: 18,
    },
    ETH: { address: ETHER_ADDRESS, decimals: 18 },
    USDCe: {
      address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
      decimals: 6,
    },
    USDC: {
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      decimals: 6,
    },
    stataUSDC: {
      address: '0x41B334E9F2C0ED1f30fD7c351874a6071C53a78E',
      decimals: 6,
    },
    aOptUSDCn: {
      address: '0x38d693cE1dF5AaDF7bC62595A37D667aD57922e5',
      decimals: 6,
    },
    USDT: {
      address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      decimals: 6,
    },
    PSTAKE: {
      address: '0x023550adde4fa2f90d63a41d9282bee0294c04cd',
      decimals: 18,
    },
    GRAIN: {
      address: '0xfd389dc9533717239856190f42475d3f263a270d',
      decimals: 18,
    },
    tBTC: {
      address: '0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40',
      decimals: 18,
    },
    GRAI: {
      address: '0x894134a25a5fac1c2c26f1d8fbf05111a3cb9487',
      decimals: 18,
    },
    LUSD: {
      address: '0xc40f949f8a4e094d1b49a23ea9241d289b7b2819',
      decimals: 18,
    },
    POPS: {
      address: '0x3D51a9fB5dCc87F7B237B04975559b920a9a56Ff',
      decimals: 18,
    },
    crvUSD: {
      address: '0xc52d7f23a2e460248db6ee192cb23dd12bddcbf6',
      decimals: 18,
    },
    OP: {
      address: '0x4200000000000000000000000000000000000042',
      decimals: 18,
    },
    sETH: {
      address: '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49',
      decimals: 18,
    },
    sUSD: {
      address: '0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9',
      decimals: 18,
    },
    wstETH: {
      address: '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb',
      decimals: 18,
    },
    rETH: {
      address: '0x9bcef72be871e61ed4fbbc7630889bee758eb81d',
      decimals: 18,
    },
    MAI: {
      address: '0xdfa46478f9e5ea86d57387849598dbfb2e964b02',
      decimals: 18,
    },
    WBTC: {
      address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
      decimals: 8,
    },
    EURA: {
      address: '0x9485aca5bbbe1667ad97c7fe7c4531a624c8b1ed',
      decimals: 18,
      symbol: 'EURA',
    },
    USDM: {
      address: '0x59d9356e565ab3a36dd77763fc0d87feaf85508c',
      decimals: 18,
    },
    wUSDM: {
      address: '0x57f5e098cad7a3d1eed53991d4d66c45c9af7812',
      decimals: 18,
    },
    stEUR: {
      address: '0x004626a008b1acdc4c74ab51644093b155e59a23',
      decimals: 18,
    },
    USDA: {
      address: '0x0000206329b97DB379d5E1Bf586BbDB969C63274',
      decimals: 18,
      symbol: 'USDA',
    },
    stUSD: {
      address: '0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776',
      decimals: 18,
    },
    frxETH: {
      address: '0x6806411765Af15Bddd26f8f544A34cC40cb9838B',
      decimals: 18,
    },
    stataUSDT: {
      address: '0x035c93db04e5aaea54e6cd0261c492a3e0638b37',
      decimals: 6,
    },
    aaveUSDT: {
      address: '0x6ab707aca953edaefbc4fd23ba73294241490620',
      decimals: 6,
    },
    waOptWETH: {
      address: '0x464b808c2c7e04b07e860fdf7a91870620246148',
      decimals: 18,
    },
  },
  [Network.GNOSIS]: {
    XDAI: {
      address: ETHER_ADDRESS,
      decimals: 18,
    },
    WETH: {
      address: '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1',
      decimals: 18,
    },
    WBTC: {
      address: '0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252',
      decimals: 8,
    },
    USDC: {
      address: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
      decimals: 6,
    },
    USDCe: {
      address: '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0',
      decimals: 6,
    },
    USDT: {
      address: '0x4ECaBa5870353805a9F068101A40E0f32ed605C6',
      decimals: 6,
    },
    COW: {
      address: '0x177127622c4A00F3d409B75571e12cB3c8973d3c',
      decimals: 18,
    },
    WXDAI: {
      address: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
      decimals: 18,
    },
    aGnoWETH: {
      address: '0xa818f1b57c201e092c4a2017a91815034326efd1',
      decimals: 18,
    },
    waGnoWETH: {
      address: '0x57f664882F762FA37903FC864e2B633D384B411A',
      decimals: 18,
    },
    aGnowstETH: {
      address: '0x23e4e76d01b2002be436ce8d6044b0aa2f68b68a',
      decimals: 18,
    },
    waGnowstETH: {
      address: '0x773CDA0CADe2A3d86E6D4e30699d40bB95174ff2',
      decimals: 18,
    },
    waGnoGNO: {
      address: '0x7c16F0185A26Db0AE7a9377f23BC18ea7ce5d644',
      decimals: 18,
    },
    aGnoUSDC: {
      address: '0xc6b7aca6de8a6044e0e32d0c841a89244a10d284',
      decimals: 6,
    },
    GNO: {
      address: '0x9c58bacc331c9aa871afd802db6379a98e80cedb',
      decimals: 18,
    },
    wstETH: {
      address: '0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6',
      decimals: 18,
    },
    aGnoWXDAI: {
      address: '0xd0dd6cef72143e22cced4867eb0d5f2328715533',
      decimals: 18,
    },
    sDAI: {
      address: '0xaf204776c7245bF4147c2612BF6e5972Ee483701',
      decimals: 18,
    },
    crvUSD: {
      address: '0xaBEf652195F98A91E490f047A5006B71c85f058d',
      decimals: 18,
    },
    SWPR: {
      address: '0x532801ED6f82FFfD2DAB70A19fC2d7B2772C4f4b',
      decimals: 18,
    },
    BREAD: {
      address: '0xa555d5344f6FB6c65da19e403Cb4c1eC4a1a5Ee3',
      decimals: 18,
    },
  },
  [Network.BASE]: {
    wstETH: {
      address: `0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452`,
      decimals: 18,
    },
    PRIME: {
      address: '0xfA980cEd6895AC314E7dE34Ef1bFAE90a5AdD21b',
      decimals: 18,
    },
    cbBTC: {
      address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      decimals: 8,
    },
    yoBTC: {
      address: '0xbCbc8cb4D1e8ED048a6276a5E94A3e952660BcbC',
      decimals: 8,
    },
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      decimals: 18,
    },
    MAV: {
      address: '0x64b88c73A5DfA78D1713fE1b4c69a22d7E0faAa7',
      decimals: 18,
    },
    crvUSD: {
      address: '0x417ac0e078398c154edfadd9ef675d30be60af93',
      decimals: 18,
    },
    USDC: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      decimals: 6,
    },
    USDM: {
      address: '0x59d9356e565ab3a36dd77763fc0d87feaf85508c',
      decimals: 18,
    },
    wUSDM: {
      address: '0x57f5e098cad7a3d1eed53991d4d66c45c9af7812',
      decimals: 18,
    },
    USDbC: {
      address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
      decimals: 6,
    },
    DOG: {
      address: '0xAfb89a09D82FBDE58f18Ac6437B3fC81724e4dF6',
      decimals: 18,
    },
    cbETH: {
      address: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
      decimals: 18,
    },
    tBTC: {
      address: '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b',
      decimals: 18,
    },
    DAI: {
      address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
      decimals: 18,
    },
    ALB: {
      address: '0x1dd2d631c92b1acdfcdd51a0f7145a50130050c4',
      decimals: 18,
    },
    BAL: {
      address: '0x4158734d47fc9692176b5085e0f52ee0da5d47f1',
      decimals: 18,
    },
    GOLD: {
      address: '0xbeFD5C25A59ef2C1316c5A4944931171F30Cd3E4',
      decimals: 18,
    },
    SDEX: {
      address: '0xFd4330b0312fdEEC6d4225075b82E00493FF2e3f',
      decimals: 18,
    },
    EURA: {
      address: '0xA61BeB4A3d02decb01039e378237032B351125B4',
      decimals: 18,
      symbol: 'EURA',
    },
    USDA: {
      address: '0x0000206329b97DB379d5E1Bf586BbDB969C63274',
      decimals: 18,
      symbol: 'USDA',
    },
    stUSD: {
      address: '0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776',
      decimals: 18,
    },
    ETH: { address: ETHER_ADDRESS, decimals: 18 },
    AERO: {
      address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      decimals: 18,
    },
    stataUSDC: {
      address: '0x4ea71a20e655794051d1ee8b6e4a3269b13ccacc',
      decimals: 6,
    },
    waBasUSDC: {
      address: '0xC768c589647798a6EE01A91FdE98EF2ed046DBD6',
      decimals: 6,
    },
    waBasGHO: {
      address: '0x88b1Cd4b430D95b406E382C3cDBaE54697a0286E',
      decimals: 18,
    },
    aaveUSDC: {
      address: '0x4e65fe4dba92790696d040ac24aa414708f5c0ab',
      decimals: 6,
    },
    aBasUSDC: {
      address: '0x4e65fe4dba92790696d040ac24aa414708f5c0ab',
      decimals: 6,
    },
    waBasWETH: {
      address: '0xe298b938631f750dd409fb18227c4a23dcdaab9b',
      decimals: 18,
    },
    waBaswstETH: {
      address: '0x0830820d1a9aa1554364752d6d8f55c836871b74',
      decimals: 18,
    },
    sUSDS: {
      address: '0x5875eee11cf8398102fdad704c9e96607675467a',
      decimals: 18,
    },
    USDS: {
      address: '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc',
      decimals: 18,
    },
    smUSDC: {
      address: '0x616a4e1db48e22028f6bbf20444cd3b8e3273738',
      decimals: 18,
    },
    weETH: {
      address: `0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A`,
      decimals: 18,
    },
    BUNNI: {
      address: '0x000000c396558ffbab5ea628f39658bdf61345b3',
      decimals: 18,
    },
    EURC: {
      address: `0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42`,
      decimals: 6,
    },
  },
  [Network.SEPOLIA]: {
    ETH: { address: ETHER_ADDRESS, decimals: 18 },
    WETH: {
      address: '0x7b79995e5f793a07bc00c21412e50ecae098e7f9',
      decimals: 18,
    },
    bal: {
      address: `0xb19382073c7a0addbb56ac6af1808fa49e377b75`,
      decimals: 18,
    },
    daiAave: {
      address: `0xff34b3d4aee8ddcd6f9afffb6fe49bd371b8a357`,
      decimals: 18,
    },
    usdcAave: {
      address: `0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8`,
      decimals: 6,
    },
    usdtAave: {
      address: `0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0`,
      decimals: 6,
    },
    aDaiAave: {
      address: `0xde46e43f46ff74a23a65ebb0580cbe3dfe684a17`,
      decimals: 18,
    },
    stataUSDC: {
      address: `0x8a88124522dbbf1e56352ba3de1d9f78c143751e`,
      decimals: 6,
    },
    stataUSDT: {
      address: `0x978206fae13faf5a8d293fb614326b237684b750`,
      decimals: 6,
    },
    DAI: {
      address: `0xB77EB1A70A96fDAAeB31DB1b42F2b8b5846b2613`,
      decimals: 18,
    },
    WBTC: {
      address: `0x29f2d40b0605204364af54ec677bd022da425d03`,
      decimals: 8,
    },
  },
  [Network.UNICHAIN]: {
    ETH: { address: ETHER_ADDRESS, decimals: 18 },
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      decimals: 18,
    },
    USDC: {
      address: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
      decimals: 6,
    },
    'USD₮0': {
      address: '0x9151434b16b9763660705744891fA906F660EcC5',
      decimals: 6,
    },
    DAI: {
      address: '0x20CAb320A855b39F724131C69424240519573f81',
      decimals: 18,
    },
    DMC: {
      address: '0x076f42d9374a2DCC98255A96bA460d7178f3cf26',
      decimals: 9,
    },
    MGO: {
      address: '0x3874BA75513f17DEFFFd784eE0c9e2158d4AF253',
      decimals: 9,
    },
    UNI: {
      address: '0x8f187aA05619a017077f5308904739877ce9eA21',
      decimals: 18,
    },
    wstETH: {
      address: '0xc02fE7317D4eb8753a02c35fe019786854A92001',
      decimals: 18,
    },
    weETH: {
      address: '0x7DCC39B4d1C53CB31e1aBc0e358b43987FEF80f7',
      decimals: 18,
    },
    ezETH: {
      address: '0x2416092f143378750bb29b79eD961ab195CcEea5',
      decimals: 18,
    },
    rsETH: {
      address: '0xc3eACf0612346366Db554C991D7858716db09f58',
      decimals: 18,
    },
  },
};

export const Holders: {
  [network: number]: { [tokenAddress: string]: Address };
} = {
  [Network.MAINNET]: {
    FLUID: '0x2d675D4C52a8aE117b935fF98c6F9f29A15827F0',
    USDS: '0x67A9e0F4Cc10C3F6cb55503e0888129039Ea7C90',
    sUSDS: '0x0955F0D3729E035B9f5b808fEcd602B2891A32fc',
    SKY: '0x0ddda327A6614130CCb20bc0097313A282176A01',
    MKR: '0xe9aAA7A9DDc0877626C1779AbC29993aD89A6c1f',
    // Idle tokens
    AA_wstETH: '0xd7C1b48877A7dFA7D51cf1144c89C0A3F134F935',
    'AA_idle_cpPOR-USDC': '0x085c8eaccA6911fE60aE3f8FbAe5F3012E3A05Ec',
    'BB_idle_cpFAS-USDT': '0xFDAD59EF0686C3Da702b7D651a3bD35a539c8Bc4',
    AA_steakUSDC: '0x28C1eCF5B0f16E1D85B9D2677EfB79d68167cAf2',
    BB_steakUSDC: '0x442Aea0Fd2AFbd3391DAE768F7046f132F0a6300',
    AA_Re7WETH: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
    BB_Re7WETH: '0x442Aea0Fd2AFbd3391DAE768F7046f132F0a6300',
    BB_dUSDCV3: '0xFb3bD022D5DAcF95eE28a6B07825D4Ff9C5b3814',
    AA_sUSDe: '0xaFeb95DEF3B2A3D532D74DaBd51E62048d6c07A4',
    BB_sUSDe: '0xaFeb95DEF3B2A3D532D74DaBd51E62048d6c07A4',
    AA_iETHv2: '0xA118aD79E2152b9a3c7Df8B8791887762b0f1D49',
    BB_iETHv2: '0x15079cBAa74C1df2a602fAc88Bd5b98B08FfE6A4',
    ETH: '0x28C6c06298d514Db089934071355E5743bf21d60',
    USDC: '0x7713974908be4bed47172370115e8b1219f4a5f0',
    USDE: '0x8707f238936c12c309bfc2B9959C35828AcFc512',
    AMPL: '0x223592a191ECfC7FDC38a9256c3BD96E771539A9',
    WBTC: '0x6daB3bCbFb336b29d06B9C793AEF7eaA57888922',
    tBTCv2: '0x84eA3907b9206427F45c7b2614925a2B86D12611',
    sBTC: '0xA2e3475D13776C6E42ff37B47286827d959B2195',
    TUSD: '0x88369cB14F9893aEA737F61ad31Bc6d018af7985',
    aEthUSDC: '0x42EFD1E0DB4ADa762cc5092ECBD052dE7c6e72E2',
    MAV: '0x92582aa69BB6117903a01eDdfe6EFfDDe564A69f',
    BADGER: '0x34e2741a3f8483dbe5231f61c005110ff4b9f50a',
    STETH: '0x6663613FbD927cE78abBF7F5Ca7e2c3FE0d96d18',
    SUSHI: '0x8a108e4761386c94b8d2f98A5fFe13E472cFE76a',
    wstETH: '0x3c22ec75ea5D745c78fc84762F7F1E6D82a2c5BF',
    WETH: '0x6B44ba0a126a2A1a8aa6cD1AdeeD002e141Bcd44',
    USDT: '0xAf64555DDD61FcF7D094824dd9B4eBea165aFc5b',
    XAUT: '0xc4e161e8d8a4bc4ac762ab33a28bbac5474203d7',
    R: '0xBfe4c9D3235475C138a61f62e9e72FaD94A3303b',
    sDAI: '0x4C612E3B15b96Ff9A6faED838F8d07d479a8dD4c',
    CVX: '0x0aCA67Fa70B142A3b9bF2eD89A81B40ff85dACdC',
    MIM: '0xa046a8660e66d178ee07ec97c585eeb6aa18c26c',
    AnkETH: '0xF7260D4ADc48fEefd5a19a9Eb23f9747CeE15C92',
    DAI: '0xd1668fb5f690c59ab4b0cabad0f8c1617895052b',
    oldFRAX: '0x183d0dc5867c01bfb1dbbc41d6a9d3de6e044626',
    newFRAX: '0x183d0dc5867c01bfb1dbbc41d6a9d3de6e044626',
    FEI: '0x19c549357034d10db8d75ed812b45be1dd8a7218',
    BAL: '0x0659FB78b5139eE5bC9238b2C85944a112A7b591',
    OHM: '0x3D7FEAB5cfab1c7De8ab2b7D5B260E76fD88BC78',
    AURA: '0xBB19053E031D9B2B364351B21a8ed3568b21399b',
    WISE: '0x25c315e0758beeab30ee048a4e2080e7084b64b3',
    DDIM: '0x229cbd1955fee93ab6e7876c1b17f6d0b859e953',
    DODO: '0x3e19d726ed435afd3a42967551426b3a47c0f5b7',
    ADAI: '0x826c3064d4f5b9507152f5cb440ca9326e1ec8fa',
    AWETH: '0xa433105e7396070a5e1fdd7e2b2338f1bfa0de68',
    BUSD: '0xf977814e90da44bfa03b6295a0616a897441acec',
    INCH: '0x4ee7c0f5480eb1edd8902a5e8b991ed52992d5f5',
    mUSD: '0x3aD1D5CFCF9169Da73C23D85d5f2Bf53bC9d39dF',
    mBTC: '0x15A295e9BCFcF93a8721DCb9A19330fc59771271',
    renBTC: '0xAaE0633E15200bc9C50d45cD762477D268E126BD',
    tBTC: '0xC25099792E9349C7DD09759744ea681C7de2cb66',
    HBTC: '0x52885fF60Cd7Ae081e0665968C457DdACF888C90',
    GUSD: '0x550Def3DB74F583c7A1eDf2DFFE84a7398850D0c',
    LINK: '0x8d4169cCf3aD88EaFBB09580e7441D3eD2b4B922',
    ADAIv1: '0x3021026e4ff227571a5a563ad19ea657c7027e59',
    CETH: '0x712d0f306956a6a4b4f9319ad9b9de48c5345996',
    CDAI: '0xab4ce310054a11328685ece1043211b68ba5d082',
    CUSDC: '0xC2F61a6eEEC48d686901D325CDE9233b81c793F3',
    EURS: '0xC1056Adeb61a01964Ea265cA95EffB7016f9Ed78',
    EURT: '0x6914FC70fAC4caB20a8922E900C4BA57fEECf8E1',
    CRV: '0x7a16fF8270133F063aAb6C9977183D9e72835428',
    jEUR: '0x937Df4e3d6dB229A10ff0098ab3A1bCC40C33ea4',
    UST: '0xf16e9b0d03470827a95cdfd0cb8a8a3b46969b91',
    SAITAMA: '0x763d5d93f27615aac852b70549f5877b92193864',
    aETH: '0xc03c4476fbe25138bf724fa1b95551c6e6b8fd2c',
    aWETH: '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296',
    aUSDT: '0x4aef720f7bbe98f916221bbc2fb5a15efe6d2cb8',
    BBAUSD: '0x4361b7425cff39b1be9bf12cee2ef32f89656cda',
    sETH: '0x274d9E726844AB52E351e8F1272e7fc3f58B7E5F',
    sUSD: '0xe44b88dadbac54ba75beaa07aae99b243b0b9f87',
    USDD: '0xf89d7b9c864f589bbf53a82105107622b35eaa40',
    alETH: '0xBD28e1B15EcbE72706A445f77bd17FCd8Fe6f652',
    SHIBA: '0x73af3bcf944a6559933396c1577b257e2054d935',
    aEthWETH: '0x931433324E6B0b5B04E3460ef3fb3f78dda3c721',
    dUSDC: '0x2FC2F705110A7F46Ce85F701d7217EF1018f01A3',
    PSP: '0xE5E5440a1CE69C5cf67BFFA74d185e57c31b43E5',
    EUROC: '0x64AE5802620398143FC7113037769175F74825Ea',
    bC3M: '0x5f9F41497f9e11fd7D4c4B067413199682eE2CFF',
    bERNX: '0x5F7A4c11bde4f218f0025Ef444c369d838ffa2aD',
    bIB01: '0x5F7A4c11bde4f218f0025Ef444c369d838ffa2aD',
    steakUSDC: '0xC977d218Fde6A39c7aCE71C8243545c276B48931',
    EURA: '0xa116f421ff82a9704428259fd8cc63347127b777',
    stEUR: '0xdC7Aa225964267c7E0EfB35f4931426209E90312',
    USDA: '0x2686bC6A56D205010637CE1DF124b20Cb19E4054',
    stUSD: '0x4e83c0a323b68E3Bc7CC8a4E35326Fd0544A291E',
    crvUSD: '0xA920De414eA4Ab66b97dA1bFE9e6EcA7d4219635',
    GHO: '0x0F11640BF66e2D9352d9c41434A5C6E597c5e4c8',
    wibBTC: '0xFbdCA68601f835b27790D98bbb8eC7f05FDEaA9B',
    MATIC: '0x7073783eee7e9b3e6e4ddac4d7f49dc46044dd9a',
    POL: '0x05A47D9f589a001C15E38D068dCc5DaE6D96a2eb',
    SDEX: '0xB0470cF15B22a6A32c49a7C20E3821B944A76058',
    frxETH: '0x9df2322bdAEC46627100C999E6dDdD27837fec6e',
    LUSD: '0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA',
    BNT: '0xf727e20e081aAE428E7c6bE07b156bB21ab587a7',
    USDe: '0x74e6c48e667d698a4cf90665b6960a5bae39e603',
    eETH: '0x0f1DfeF1a40557d279d0de6E49aB306891A638b8',
    stataUSDT: '0x6803364AceD5181877abC11E865FB27cB654a426',
    aaveUSDT: '0x464C71f6c2F760DdA6093dCB91C24c39e5d6e18c',
    waEthUSDT: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
    waEthUSDC: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
    weETH: '0x267ed5f71EE47D3E45Bb1569Aa37889a2d10f91e',
    rUSD: '0xEC2eda1C4F981E468ABF62424a10B69B738b498E',
    arUSD: '0xeFc24206053a452e2299BF3b8f964512b041Db4C',
    USD0: '0x224762e69169E425239EeEE0012d1B0e041C123D',
    M: '0xA370275bb06b7416184A967C5B8593942784CDFe',
    WrappedM: '0xfAc0973a7D0B847367F6DD46FD470Ee069aAB845',
    'USD0++': '0x2227b6806339906707b43F36a1f07B52FF7Fa776',
    USDM: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
    wUSDM: '0x3B95bC951EE0f553ba487327278cAc44f29715E5',
    USDL: '0xAb96AA0ee764924f49fbB372f3B4db9c2cB24Ea2',
    wUSDL: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
    UsualM: '0xE3f7A0c4a44b740328157A5152A85c3bCB54DA09',
    EKUBO: '0xF5b6Ee2CAEb6769659f6C091D209DfdCaF3F69Eb',
    cbBTC: '0x5c647cE0Ae10658ec44FA4E11A51c96e94efd1Dd',
  },
  [Network.POLYGON]: {
    jGBP: '0x02aa0B826c7BA6386DdBE04C0a8715A1c0A16B24',
    MATIC: '0xfCbB9e5BB354B6F9fd40362Cee043F510dd3028D',
    DAI: '0x98F911D496Cf46bf9FF9CdD7039Cf579B26F01B9',
    WETH: '0x62ac55b745f9b08f1a81dcbbe630277095cf4be1',
    WMATIC: '0x0AFF6665bB45bF349489B20E225A6c5D78E2280F',
    AMWMATIC: '0x975779102B2A82384f872EE759801DB5204CE331',
    USDC: '0xf89d7b9c864f589bbf53a82105107622b35eaa40',
    BAL: '0xF1CFf6380D9A15dB33Eed0309541E254fC7dE695',
    AAVE: '0x256e063f7fb60a3004D13e1D09e7A9D200A5C5bA',
    PSP: '0xa902c6a26bcaC4c62Eb8667E3Ef9368f78421dB5',
    POPS: '0x2693b57ee51f4e2a26dfb339a911fa8731061f49',
    MUST: '0x9f2a409848fb9b7bd058b24a23e8dbf1e166a109',
    AMDAI: '0xFA0DCe8280FCDf369a4cbFc1830d3302789307a6',
    mUSD: '0x5084f622cbDf1E22E473d66d97916524745B9b6e',
    USDT: '0x2D55eccD5F50D325ee3CE192322911f87113bCd3',
    WBTC: '0xdc9232e2df177d7a12fdff6ecbab114e2231198d',
    AMWETH: '0x6f1c28c40b5fed4fb546f85959ae2f7c16365cad',
    KNC: '0x41Af7fd16dFC29bdA8D8aAA4CeFfC0E8046992eC',
    jEUR: '0x807B465fC3f72aF3AAfda74480CA7E4E55964cd3',
    aUSDT: '0x027ffd3c119567e85998f4e6b9c3d83d5702660c',
    aPolUSDT: '0x941da3d6759147736456cee36647213183079337',
    aPolWMATIC: '0xfB3C01F90B4629DBD4Fd5310E995Ef3FE2e7AbeE',
    RADIO: '0x60531b9c3645546d864604ee0fc5b7d6adc81cc2',
    HANZO: '0x8a151b6ec99c7b90b342ab401d511b480309b220',
    RVLT: '0x815f87ca3db2b9491115a7769aeacb140361c5a9',
    stMATIC: '0x7C8963BddC17095aDbc9387Cc6cdcCaA798feA52',
    axlUSDC: '0x9298F93ee0393a823C242D80F1a4aDf4c8a3Feef',
    deUSDC: '0x94d5ead1f80cf0b4d3480ab59dff16d47c93e9fe',
    amUSDT: '0x832b11846a27b3ba25d68ae80c39fab155d18c49',
    amUSDC: '0x6e7f19cd23049c7118e14470e2bf85d2e26ee0ae',
    MAI: '0x9a8cf02f3e56c664ce75e395d0e4f3dc3dafe138',
    SDEX: '0xB0470cF15B22a6A32c49a7C20E3821B944A76058',
    WOLF: '0x4aa6907Fa9F1BC2Be15158897E0138E947C86956',
    CRV: '0x2151578e1fEc29361bB0481312Ea6b935014D636',
    SUSHI: '0x1605CE87dD176b38a17d30e8926370ffD5268bf6',
    EURA: '0x9A760aa1Fe631fD9aC0Aee0965736121c7c132cc',
    stEUR: '0xA9DdD91249DFdd450E81E1c56Ab60E1A62651701',
    USDA: '0x741383AbD73891b40822A069f14d6fc5b5685020',
    stUSD: '0xA9DdD91249DFdd450E81E1c56Ab60E1A62651701',
    stataUSDCn: '0xFAB1420c84fF5E058B8AD12604D24247e268f362',
    aaveUSDCn: '0xEBA9C3C1B41A846431F970aCA5Eee10f55969B76',
    crvUSD: '0x61aE20E0292a5E6CF2F017236755246BB9e0f57a',
    USDCe: '0xA67EFB69A4f58F568aAB1b9d51110102985835b0',
    USDCn: '0x4B6f17856215eab57c29ebfA18B0a0F74A3627bb',
    USDM: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
    wUSDM: '0xC98D785ECEEa2b074fffc24F682c8AD9fA2D9D8d',
    TRYB: '0xD05007f1BD1304bFAEb370Ec5EbD18fD02a581e6',
  },
  [Network.BSC]: {
    DAI: '0xf68a4b64162906eff0ff6ae34e2bb1cd42fef62d',
    WBNB: '0x59d779bed4db1e734d3fda3172d45bc3063ecd69',
    BUSD: '0x0D0707963952f2fBA59dD06f2b425ace40b492Fe',
    POPS: '0x4b78b52e7de4d8b7d367297cb8a87c1875a9d591',
    BNB: '0xf68a4b64162906eff0ff6ae34e2bb1cd42fef62d',
    USDT: '0xf89d7b9c864f589bbf53a82105107622b35eaa40',
    ETH: '0xefdca55e4bce6c1d535cb2d0687b5567eef2ae83',
    USDC: '0x554b52bf57b387fd09d6644368c5a8aacaaf5ae0',
    RADIO: '0x75b3efed620e2d6750d88263cd4d7a27b0d7d3c5',
    bBTC: '0x72a53cdbbcc1b9efa39c834a540550e23463aacb',
    anyBTC: '0x4ffef8e8a75c20ab0ddf96c50d2457277d27923c',
    nUSD: '0x28ec0b36f0819ecb5005cab836f4ed5a2eca4d13',
    axlUSD: '0xc03fbeda9069b22a120ae6a09349a0b5eea5570a',
    FRAX: '0xEB4576fE753DAB07635c0Bb6c8f0A355e1Db5d31',
    frxETH: '0xf324adC872005197A6f7DAE214d3b63aa0C3625F',
    USDFI: '0x2E00D722e091836B39Db3e4dcE6eE51c90c5B221',
    SDEX: '0xB0470cF15B22a6A32c49a7C20E3821B944A76058',
    BNBx: '0xFF4606bd3884554CDbDabd9B6e25E2faD4f6fc54',
    EURA: '0x4A5362ef534FFB27510E4E4C9A215BB5436377C2',
    USDA: '0x230c1f68aBE6033Cba3Fe0D2C0D7097e9923C3bC',
    stUSD: '0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776',
    stataUSDT: '', // no holders yet
    aaveUSDT: '0x5DE3c5BE52D7aDbdC3aEFe2eA061A2ECE0C7d766',
  },
  [Network.AVALANCHE]: {
    LINKe: '0x9efa0A617C0552F1558c95993aA8b8A68b3e709C',
    AVAX: '0xD6216fC19DB775Df9774a6E33526131dA7D19a2c',
    avWAVAX: '0xc5ed2333f8a2C351fCA35E5EBAdb2A82F5d254C3',
    WAVAX: '0x5CfCd7E6D055Ba4f7B998914336254aDE3F69f26',
    sAVAX: '0xC73DF1e68FC203F6E4b6270240D6f82A850e8D38',
    BETS: '0x8cc2284c90d05578633418f9cde104f402375a65',
    HATCHY: '0x14ec295ec8def851ec6e2959df872dd24e422631',
    USDCe: '0x3a2434c698f8d79af1f5a9e43013157ca8b11a66',
    USDC: '0x64b4dE1b00EF830f3CC2FD68ee056aAD76C45BF6',
    USDTe: '0x84d34f4f83a87596cd3fb6887cff8f17bf5a7b83',
    WETHe: '0x9bdB521a97E95177BF252C253E256A60C3e14447',
    POPS: '0x5268c2331658cb0b2858cfa9db27d8f22f5434bc',
    ETH: '0x9852e84b5AA485683d8AeE7B0332e42442763b75',
    DAIE: '0xED2a7edd7413021d440b09D654f3b87712abAB66',
    TUSD: '0x5Db946411F08f15300f23D9bde4A407B07D56C03',
    PNG: '0x348b11CF986e8E1CdA10c4A7E375aA252b47fc55',
    SHIBX: '0xfE5ADf65BE1a46b83EF3d352A8F9258A039f3050',
    wBTC: '0xbB2BD754A45f400A01158A8b3C89DE085D58ABF1',
    renBTC: '0xb8D1D22609D10078Db36915fc4610F8674b44319',
    ADAI: '0xc5ed2333f8a2C351fCA35E5EBAdb2A82F5d254C3',
    MIM: '0x64cb3f5aada07d831b8db6c6d9c715c53c251ef3',
    TSD: '0x691A89db352B72dDb249bFe16503494eC0D920A4',
    THO: '0xc40d16c47394a506d451475c8a7c46c1175c1da1',
    aAvaUSDT: '0x50B1Ba98Cf117c9682048D56628B294ebbAA4ec2',
    USDT: '0xCddc5d0Ebeb71a08ffF26909AA6c0d4e256b4fE1',
    aAvaWAVAX: '0x1B18Df70863636AEe4BfBAb6F7C70ceBCA9bA404',
    oldFRAX: '0x4e3376018add04ebe4c46bf6f924ddec8c67aa7b',
    newFRAX: '0x4e3376018add04ebe4c46bf6f924ddec8c67aa7b',
    nETH: '0xcf2ef00e75558512ae735679ea5df62ad2056786',
    avWETH: '0x92d78e32b990d10aeca0875dc5585f1a6f958179',
    YUSD: '0x86D0c0e4B8CC5409144f66E6E76b904bb9ce9cDb',
    BTCb: '0x2446bEb3905CfFbd2c5eB18F1f9c2996B05257c4',
    AMPL: '0xfcaA5ea7F8eb0631BcA72C345025C0A5a6D93f0E',
    PHAR: '0x654296D56532f62B7d91d335791d3c364a9385b5',
    stataUSDT: '', // no holders yet
    aaveUSDT: '0xB2d3ad6e99D2A043EF77e3812461Ad2D4Ae3da8B',
    ARENA: '0xEBf747761b6942adaBAA58A594BA24931AfA0a3F',
    TRYB: '0x7137FdccfB6Ee406771E8F5c1B466e4d3074dd45',
  },
  [Network.ARBITRUM]: {
    SEN: '0x76d39045d856caf9bfae12ba611ca4a94449a4f1',
    RDPX: '0x115b818593c00da4f9d1d8f5ce7d7f88cce48bee',
    ARB: '0xb65edba80a3d81903ecd499c8eb9cf0e19096bd0',
    weETH: '0xE957D8386d20D077F511E86672Fc7ee4b83067da',
    ETH: '0xfa0a32e5c33b6123122b6b68099001d9371d14e9',
    DAI: '0x2d070ed1321871841245d8ee5b84bd2712644322',
    WETH: '0x3368e17064c9ba5d6f1f93c4c678bea00cc78555',
    BAL: '0x7b7b957c284c2c227c980d6e2f804311947b84d0',
    USDCe: '0x62383739d68dd0f844103db8dfb05a7eded5bbe6',
    USDC: '0xb38e8c17e38363af6ebdcb3dae12e0243582891d',
    OHM: '0xebce5f29ff5ca9aa330ebdf7ec6b5f474bff271e',
    USDT: '0xf977814e90da44bfa03b6295a0616a897441acec',
    POPS: '0x4b78b52e7de4d8b7d367297cb8a87c1875a9d591',
    FRAX: '0x59bf0545fca0e5ad48e13da269facd2e8c886ba4',
    nUSD: '0x9dd329f5411466d9e0c488ff72519ca9fef0cb40',
    nETH: '0xa067668661c84476afcdc6fa5d758c4c01c34352',
    AAVE: '0x8D2876aD4D2A994C529F19D846CA541015dc3f05',
    aArbAAVE: '0x439901eCaB06F75B14bC25fD60d53bB3A3b9e277',
    EURS: '0x251aeE4A9eB1d8251485D1A9b3bE68975B39EC33',
    aArbEURS: '0xD2BC982A2035dB0E1Be7c2C1a9f87E31794C653e',
    MIM: '0xf46bb6dda9709c49efb918201d97f6474eac5aea',
    VST: '0x59bf0545fca0e5ad48e13da269facd2e8c886ba4',
    aArbUSDC: '0x048BF2F5908e95976CeAD0E47D805b3803E286e2',
    waArbUSDT: '0xa6D12574eFB239FC1D2099732bd8b5dC6306897F',
    ZYB: '0x3ec0eddcd1e25025077327886a78133589082fb2',
    WBTC: '0xd9d611c6943585bc0e18e51034af8fa28778f7da',
    RDNT: '0x62383739d68dd0f844103db8dfb05a7eded5bbe6',
    SDEX: '0xb0470cf15b22a6a32c49a7c20e3821b944a76058',
    LINK: '0x7f1fa204bb700853d36994da19f830b6ad18455c',
    DMT: '0x40414f138eb2ef938e6c3629897ef99d4464d4e8',
    PENDLE: '0x5bdf85216ec1e38d6458c870992a69e38e03f7ef',
    wstETH: '0xb3843D7BBb8530f95e5bEaBeff451fA5380510a8',
    EURA: '0x6dd7b830896b56812aa667bdd14b71c8b3252f8e',
    stEUR: '0xE588611e7A2392507879E3be80531654b85C16aA',
    USDA: '0xa86ff337db9107b54862d30d1a598f8be847b05e',
    stUSD: '0xBa511aAd739358b2F34285f9E2d5344017b7DcaD',
    stataUSDT: '0xc5042f9d9a18e95547864438455c8f05b4987399',
    aaveUSDT: '0xAfa788fab589fe61C23DF76905558f4734444D67',
    crvUSD: '0x9755e99bdb99495d3d31d953785d993c6df8552e',
    GHO: '0xda39E48523770197EF3CbB70C1bf1cCCF9B4b1E7',
    USDM: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
    wUSDM: '0x12c9cE6b155c8aaC74004732A621B64bC669bb79',
    waArbWETH: '0x854B004700885A61107B458f11eCC169A019b764',
    USDS: '0x2f47a6D6115AF4fC1935f5C9079C8aCBA92E5aB4',
    sUSDS: '0x999F26D47B916340E62A6bb924708A5007eb80Cb',
  },
  [Network.OPTIMISM]: {
    ETH: '0xF6D4E5a7c5215F91f59a95065190CCa24bf64554',
    DAI: '0x1337bedc9d22ecbe766df105c9623922a27963ec',
    WETH: '0x86bb63148d17d445ed5398ef26aa05bf76dd5b59',
    POPS: '0x3cbd9044aaabef08ce93a68448e093cff405ad76',
    USDCe: '0xdecc0c09c3b5f6e92ef4184125d5648a66e35298',
    USDC: '0x8aF3827a41c26C7F32C81E93bb66e837e0210D5c',
    aOptUSDCn: '0x38d693cE1dF5AaDF7bC62595A37D667aD57922e5',
    USDT: '0xf977814e90da44bfa03b6295a0616a897441acec',
    OP: '0xEBb8EA128BbdFf9a1780A4902A9380022371d466',
    aOptWETH: '0x7B7D80C40415F744864f051B806b466e2fbB8E68',
    aOptUSDC: '0x8c0Fcf914E90fF5d7f2D02c1576BF4245FaD2B7F',
    sBTC: '0xbbb33d2e7bd7ddc722e53da9ca8ee97df41cfabf',
    sETH: '0xce3850927d0e631b6082f9d45a6391a3794c51eb',
    sUSD: '0xa5f7a39e55d7878bc5bd754ee5d6bd7a7662355b',
    wstETH: '0x63f6D9E7d3953106bCaf98832BD9C88A54AfCc9D',
    rETH: '0x4c2e69e58b14de9afedfb94319519ce34e087283',
    WBTC: '0xb9c8f0d3254007ee4b98970b94544e473cd610ec',
    frxETH: '0x4d4edf8291d169f975b99914b6ab3326abb45938',
    EURA: '0x9A760aa1Fe631fD9aC0Aee0965736121c7c132cc',
    stEUR: '0xA9DdD91249DFdd450E81E1c56Ab60E1A62651701',
    USDA: '0x7dFf12833a6f0e88f610E79E11E9506848cCF187',
    stUSD: '0xC98b0729695A25152B8D5b6B95709070605A7F60',
    crvUSD: '0x7a16fF8270133F063aAb6C9977183D9e72835428',
    LUSD: '0xf0a9abb11958a071e168f2ee5bcbacf1abbde9cf',
    GRAI: '0x92b051204816DC4fbA7AC1A68a2cf319A9a387CB',
    stataUSDT: '0xd55263b84685Ced7e10a77607C7fFD763D495B6e',
    stataUSDC: '0x450C01300B83bE379113256038b4Dd3b45d23B5e',
    aaveUSDT: '0x1Fd458C52fEb7Bb35097ebd9566DB6C269341FDD',
    tBTC: '0xf7b4531e52211CC44379102F719cad29411dB053',
    PSTAKE: '0xc45398444B83183b2018e0224B3D332b42D492Af',
    USDM: '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812',
    wUSDM: '0x1Ab0b1A5A239B524702EcE9cCe77E096d4daE75B',
  },
  [Network.GNOSIS]: {
    GNO: '0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f',
    COW: '0x4fFAD6ac852c0Af0AA301376F4C5Dea3a928b120',
    XDAI: '0x9fc062032d4F2Fe7dAA601bd8B06C45F9c8f17Be',
    WXDAI: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    WETH: '0x800e12aF6c96790EDDdc5B3f3302899e27B2A918',
    USDT: '0x1098503a90c3224F0e6BE7c124a337888C0BA564',
    WBTC: '0x8e5bBbb09Ed1ebdE8674Cda39A0c169401db4252',
    USDC: '0xd4A39d219ADB43aB00739DC5D876D98Fdf0121Bf',
    aGnoWXDAI: '0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f',
    aGnoUSDC: '0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f',
    wstETH: '0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f',
    aGnowstETH: '0x458cD345B4C05e8DF39d0A07220feb4Ec19F5e6f',
    sDAI: '0x79f08F2e75A8C99428DE4A2e6456c07C99E55da5',
    USDCe: '0x555CE236C0220695b68341bc48C68d52210cC35b',
    crvUSD: '0xE4A982fa1f1E8AD1AF238A7b1226b13b56bf5CcD',
    SWPR: '0x9467dcFD4519287e3878C018c02f5670465a9003',
    waGnoWETH: '0x854B004700885A61107B458f11eCC169A019b764',
    waGnowstETH: '0x854B004700885A61107B458f11eCC169A019b764',
    waGnoGNO: '0x9Ec6472Fc33D9a5D17613484aDF0295A001fDF32',
  },
  [Network.BASE]: {
    WETH: '0x24D61e5411C143135068557AfD06546d81A751b8',
    PRIME: '0xe3879b7359695f802d6FD56Bb76fD82C362Dafd6',
    ETH: '0xd34ea7278e6bd48defe656bbe263aef11101469c',
    MAV: '0xf977814e90da44bfa03b6295a0616a897441acec',
    USDC: '0x21bD501F86A0B5cE0907651Df3368DA905B300A9',
    USDbC: '0x989BA24cb7938C1672B1e9Cea873cf4d7629a5FE',
    DAI: '0x20f03e26968b179025f65c1f4afadfd3959c8d03',
    BAL: '0x854b004700885a61107b458f11ecc169a019b764',
    GOLD: '0x1374c25b3710758c326ee0c70ec48b595d5ccf8c',
    SDEX: '0xa5d378c05192e3f1f365d6298921879c4d51c5a3',
    EURA: '0x5b5614b9fffab7c751799eb12d5cb9165c8c40ad',
    stEUR: '0xA9DdD91249DFdd450E81E1c56Ab60E1A62651701',
    USDA: '0x7FE4b2632f5AE6d930677D662AF26Bc0a06672b3',
    stUSD: '0x8deeffb6047b8ee91b09334eb2a4ca120f43f596',
    ALB: '0x365c6d588e8611125de3bea5b9280c304fa54113',
    AERO: '0x807877258b55bfefabdd469da1c72731c5070839',
    tBTC: '0x9f1920d0cbb63ed03376a1e09fd2851d601234c8',
    DOG: '0xbe3ab8a87730684ef1e476064c2e43c3e982f8e8',
    stataUSDC: '0x88Cac91ADDE2208039A227B373C2A692C0700547',
    aaveUSDC: '0x5DE3c5BE52D7aDbdC3aEFe2eA061A2ECE0C7d766',
    waBasUSDC: '0x450C01300B83bE379113256038b4Dd3b45d23B5e',
    USDM: '0x426c4966fC76Bf782A663203c023578B744e4C5E',
    crvUSD: '0xBbAbDB1385deA5285113581A7024d6DC04131101',
    cbETH: '0x50e011dD1e2b4906F1534623cD134B30422bb11E',
    wUSDM: '0xe30965Acd0Ee1CE2e0Cd0AcBFB3596bD6fC78A51',
    aBasUSDC: '0xC006544B93e86E8999623C1D12d2E352c61C8123',
    waBasWETH: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
    wstETH: '0x96892b8FBd24e0aC40BD98A304095a6c485A6A68',
    waBaswstETH: '0x854B004700885A61107B458f11eCC169A019b764',
    smUSDC: '0x88457F47c9BEC8379eB90d8dC3592F79084e555d',
    waBasGHO: '0x450C01300B83bE379113256038b4Dd3b45d23B5e',
    USDS: '0x87549A7DF7a002f756118EB19b59C2317E227017',
    sUSDS: '0xC9716E991396AA933Fa7A481003a5953bcBabC17',
    cbBTC: '0x88fC6C82672081dA02f60996785fe8Cf67A2A85b',
  },
  [Network.SEPOLIA]: {
    bal: '0xDb4ff41B4C1222c2b1869A67Be115070688989a2',
    daiAave: '0xbB0bc84687fFb642fd90a3D12215e7eC16352A49',
    WETH: '0x546e37DAA15cdb82fd1a717E5dEEa4AF08D4349A',
    ETH: '0x2CdA41645F2dBffB852a605E92B185501801FC28',
    stataUSDC: '0x75D06bae37a9c349142fE7cee77804900b1C0EC3',
    stataUSDT: '0x75D06bae37a9c349142fE7cee77804900b1C0EC3',
    usdcAave: '0xdD5De55eA6804EFb283f43b0C091C25000a6486c',
    DAI: '0x90347b9CC81a4a28aAc74E8B134040d5ce2eaB6D',
  },
  [Network.UNICHAIN]: {},
  [Network.SONIC]: {},
};

export const NativeTokenSymbols: { [network: number]: string } = {
  [Network.MAINNET]: 'ETH',
  [Network.POLYGON]: 'MATIC',
  [Network.BSC]: 'BNB',
  [Network.AVALANCHE]: 'AVAX',
  [Network.SONIC]: 'S',
  [Network.ARBITRUM]: 'ETH',
  [Network.OPTIMISM]: 'ETH',
  [Network.BASE]: 'ETH',
  [Network.SEPOLIA]: 'ETH',
  [Network.GNOSIS]: 'XDAI',
  [Network.UNICHAIN]: 'ETH',
};

export const WrappedNativeTokenSymbols: { [network: number]: string } = {
  [Network.MAINNET]: 'WETH',
  [Network.POLYGON]: 'WMATIC',
  [Network.BSC]: 'WBNB',
  [Network.AVALANCHE]: 'WAVAX',
  [Network.SONIC]: 'WS',
  [Network.ARBITRUM]: 'WETH',
  [Network.OPTIMISM]: 'WETH',
  [Network.BASE]: 'WETH',
  [Network.SEPOLIA]: 'WETH',
  [Network.GNOSIS]: 'WXDAI',
};
