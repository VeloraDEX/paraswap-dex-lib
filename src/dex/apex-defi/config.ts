import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const defaultBaseSwapRate = 30n;

// Use arrays for token addresses and map them to their respective legacy factory addresses
const legacyFactoryV1 = '0x96a97d36fc007075e300399da892f5cedfdab0f0';
const legacyFactoryV2 = '0x3d193de151f8e4e3ce1c4cb2977f806663106a87';

// Group token addresses by legacy factory
const legacyFactoryV1Tokens = [
  '0x17404b0b841c0f8e39e46f572bac80dd4786996a',
  '0x7dea8ae0d8a7ca0f8efd112f273425a41eaa9e57',
  '0xe2ea811459fcfa57d2ac6b7525c9cedad8157fde',
  '0xcc92dee5de2bb7bd03f3c9da19d54bb9c78d25cb',
  '0x1a846c0fce81c1fa6d86f5b864ae0b2bc6059273',
  '0x944ae4704f17577cc0c1299945d1a84a1927a10b',
  '0x91d75a16e44e4259f566149cb7a5a7a3ae3a53b2',
  '0x38c618f54319f7e55b44dc80aa3c4fd29d8ab1ef',
  '0x4afc7838167b77530278483c3d8c1ffe698a912e',
  '0x0f0f78166dc0c0f7365e5e257e2976391c73a77f',
  '0xb05ee8caf4faf693f17bf0532afa5da956ac1345',
  '0xefa6f7878a55130954b2f7b6c13581495e6b6fef',
  '0xfd4da3128cb15392b21d59def3cc92fc2be0d13f',
  '0xc79d875543acdb0ac6c7136498f52cb4db0652c8',
  '0x008b15da8f8fd3d6d49336fa5599fec24afe552f',
  '0x36c6f9b269abde0eb0dddb202bbd8a360aea4be8',
  '0xfb4960583724561ca7a347c5d013f77e664b266c',
  '0x79eaace5a189f363793baaf26763ddb4743c3ce1',
  '0x5762b5671790e2b216261ef7fdbe4131a0d18b99',
  '0x3900f2859fb57a6cee7eddc86d4469c182fa3534',
  '0x82eef3abe26237eb65c7badf68d431cd8f78a683',
  '0x588b8b827c2c161430dbff83fe6f40f57da7d1aa',
  '0x6cc7092ede43ebb103904a2c0342bf1410a5c3f6',
  '0x3d95994f45514487adcfa976dee2f3f601a1b338',
  '0xd71ef392cb5dd3c9d7742e6726648a105067ef63',
  '0xe6420892c81efe4a26f938ae90cc2070ebeef24d',
  '0xa8ab3fe610086e81819e1ece6ac7ebf2576c6eeb',
  '0xe81a9a5a369c340b879f72cd6775bc2376c90df8',
  '0xc5a431b35ef7f485328cd19250e6956d8cef5683',
  '0xa2de3f5251883cc1810efd7c7bfaada12372a018',
  '0x9e992b7ee1b5b074eb2642bec42dfbf64f3a8a9e',
  '0x0ce578b02acda03ef35ebb23999179a29316de2e',
  '0x98b172a09102869add73116fc92a0a60bff4778f',
  '0xf96b998a2c7fea5459bbca7b3dc78fe1c0f8359c',
  '0x79c5fa00f04ba7992d18b13b7fcff28bd27a9dad',
  '0x00905c0a867b616f7374576d55635eaccfe8b332',
  '0x4e63afb0a6a35e8e7549f4d2281e8dec22d26fac',
  '0x4c726f6159a883e94b87984d827453f6f5955098',
  '0xe9c2b304a4dbf0fe8546e5e4e2c415f5d5e4b7c4',
  '0x71e1f20fb83e787d05ebb0aab9674ecf0f28b407',
  '0x8ac1cd74a2d9b3db244b162a1f30fbc7e08ed7bf',
  '0xe61ee8276e6600d09acf840ac6471492579a4ab6',
  '0xa99d995bb131da21d10d757fe015bbc6e851e0bb',
  '0x24a89a869e1209457e794817a5b915ee1c16ff09',
  '0x448ed030a8c377328159da6ec66d5aed3fbdb8fa',
  '0xf8e4c00a8d8ae27043e4b853dec33f2984cdeef2',
  '0x13c860f32360f5f7e3a070e920d6d4796c6b443e',
  '0x229d5152f13539dd861ae5d1d16c5626a6f9ac61',
  '0x6bee8b854de110ee8fe388d98b87ccda571b556b',
  '0xcbd5780f7476604db30efa9c0b96a512ba562e2d',
  '0x51a85fd8c1fc944817b5fc910abc2735d553681b',
  '0x76e75dddcb41e6483e9cc68749705a5f5cdbe568',
];

const legacyFactoryV2Tokens = [
  '0x8686f436a72a07c83b135feaf4f6a8beaea2e66f',
  '0x675a32a03066176bbd874a25f142e580ea37cae2',
  '0x34f3aa78b0089e80475b92cb0fa289877e9c357e',
  '0xfe83e7be7c3f5cfce923f127f23e006a8f44c002',
  '0xbfa7f5417c6af5bf6b7db2e5290d6092a418f7b2',
  '0xf963ddc3fafe28bb981eaedce39f16df5ce5e031',
  '0x0187dae59e7ae63ccd5104c092262b18d1d97498',
  '0x3624df10c5b5e30a30107f765d3984326f5c594d',
  '0x915c2ca66fc6449b3388c583bd2a7ca40d8bd272',
  '0x9dc263968b22443d27d20e2e2d4ae70c26424116',
  '0xcbc002dd50a9c2a44637b4c9a189f291f72813fd',
  '0x23f19d8e221d8a718f4b3394b39f39ac26700b96',
  '0x2fa60c36a03fd7a4159205b97fbc109d028f4ed3',
  '0x97fb5798a26213330a51316ad8f45525537c1baf',
  '0xd428a6135c2286438da1473bfce2d95c99570ec2',
  '0x1849426872ed67e7e5056b157899e9ae5a86c251',
  '0xe264ae36ea4e5b7d94da6e6e7046fefb1eda4cd3',
  '0x381f7fa5d842731f8416f956c3fb8ff3d6b197da',
  '0x3083b20ff79aa760777ff6883438b0dc5e0dab60',
  '0xc4a1b521537a5a5e7d28bacc948de2e3168ac289',
  '0x3d57477e2821d51fc45ccb871920c8e4a0c61580',
  '0x85bbc902bb8651f55da8f807399d064dc9c37c84',
  '0x737bef45d9cc7268751f43eb1545d85917891b83',
  '0xf555507d66948de07b185f96f3d2dd3300009722',
  '0x9aa7fc6b03c9743ae676afb14cf8805c2cbdc207',
  '0xbbe4ece3cd7bdf712203d57b9ac266d9aa0fee91',
  '0x57d712380d9ff8a29743a64a44011e6d4a2e4e29',
  '0x15f8a2bdc687704686f0db9ee5ef4e904f384704',
  '0x9d8fe2a886cc87e5fc7a3cbee6228b8258c6d097',
  '0x8b4572eaaee0604eaa356249adf9dcdb004ee58a',
  '0xc4ab79718232ea397a9c90e888820d3decc8a4a8',
  '0x090fc707457b75ae4c72d27f83b050b37cd9829b',
  '0x1bd744780607e4bd79a9e669aea311ae4acb19e0',
  '0xd9a87d2eb37c6e332e415db5fca9f3e59167ba1a',
  '0x02789c830cca0f431749ceaffc80c37eb68e7940',
  '0x1a37adea15e9cbdfc1d1ad144bf404a734686299',
  '0xdea526ee286c43e828d91a41a105c7d63c0e1150',
  '0xcf1b06e3d83b3c76238332ceeb775cb631851c98',
  '0x32446ca3128d6132fe42bb61602b60ba3850a1ce',
  '0xea98b8b8cf202b70de44d1c72ebb2c7d8f64369a',
  '0x9b126aa5e8f7d8c802a1511929f320cccf8fde96',
  '0x4621e92df0fe55ec775405d412c7684bf1f9d8a6',
  '0xd30ec104898be3740efaec7bb26bb3c0cab0c451',
  '0xb8c7a3a7e87d8db5703ad1c057b7c3156327bba8',
  '0x71ba6d39d1ac3edd1a9aaba533e80f026bf079e9',
  '0xed612bf18726e86e74fa6cb6c31a2967390fda9a',
  '0xe012595aea0c750c002b355678722f14fa779280',
  '0x213c95dccb3c7b3aaa025bbf487bcf35f9b2a92b',
  '0x871d26d4931cabc737efb66276f84c02c2a8c367',
  '0x0ad2b5978d7a4386dfbae2544a2e162f229b64d1',
];

// Helper to build the legacyFactoryMappings object
function buildLegacyFactoryMappings(): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const addr of legacyFactoryV1Tokens) {
    mapping[addr] = legacyFactoryV1;
  }
  for (const addr of legacyFactoryV2Tokens) {
    mapping[addr] = legacyFactoryV2;
  }
  return mapping;
}

export const ApexDefiConfig: DexConfigMap<DexParams> = {
  ApexDefi: {
    [Network.AVALANCHE]: {
      factoryAddress: '0x754A0c42C35562eE7a41eb824d14bc1259820f01',
      routerAddress: '0x5d2dDA02280F55A9D4529eadFA45Ff032928082B',
      wrapperFactoryAddress: '0x709D667c0f7cb42e6099B1a2b2B71409086315Cc',
      legacyFactoryMappings: buildLegacyFactoryMappings(),
    },
  },
};
