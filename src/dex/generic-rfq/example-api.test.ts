import {
  constructAxiosFetcher,
  constructBuildLimitOrder,
  constructEthersContractCaller,
  constructPartialSDK,
  constructSignLimitOrder,
  LimitOrderToSend,
} from '@paraswap/sdk';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import express from 'express';
import {
  RFQPayload,
  PairPriceResponse,
  TokenWithInfo,
  TokensResponse,
  PairsResponse,
  RatesResponse,
} from './types';
import { reversePrice } from './rate-fetcher';

const tokens: TokensResponse = {
  tokens: {
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      description: 'Canonical wrapped Ether on Ethereum mainnet',
      decimals: 18,
      type: 'ERC20',
    },
    DAI: {
      symbol: 'DAI',
      name: 'Wrapped Ether',
      address: '0x6b175474e89094c44da98b954eedeac495271d0f',
      description: 'Canonical wrapped Ether on Ethereum mainnet',
      decimals: 18,
      type: 'ERC20',
    },
  },
};

const pairs: PairsResponse = {
  pairs: {
    'WETH/DAI': {
      base: 'WETH',
      quote: 'DAI',
      liquidityUSD: 468000,
    },
  },
};

const addressToTokenMap = Object.keys(tokens.tokens).reduce((acc, key) => {
  const obj = tokens.tokens[key];
  if (!obj) {
    return acc;
  }
  acc[obj.address.toLowerCase()] = obj;
  return acc;
}, {} as Record<string, TokenWithInfo>);

const prices: RatesResponse = {
  prices: {
    'WETH/DAI': {
      bids: [
        ['1333.425240000000000000', '1.166200000000000000'],
        ['1333.024812000000000000', '1.166200000000000000'],
        ['1332.624384000000000000', '1.166200000000000000'],
        ['1332.223956000000000000', '1.166200000000000000'],
        ['1331.823528000000000000', '1.166200000000000000'],
        ['1331.423100000000000000', '1.169000000000000000'],
      ],
      asks: [
        ['1336.745410000000000000', '1.166200000000000000'],
        ['1337.146033000000000000', '1.166200000000000000'],
        ['1337.546656000000000000', '1.166200000000000000'],
        ['1337.947279000000000000', '1.166200000000000000'],
        ['1338.347902000000000000', '1.166200000000000000'],
        ['1338.748525000000000000', '1.169000000000000000'],
      ],
    },
  },
};

const blacklist = {
  blacklist: ['0x6dac5CAc7bbCCe4DB3c1Cc5c8FE39DcDdE52A36F'],
};

export const startTestServer = (account: ethers.Wallet) => {
  const app = express();

  // to overcome isEmpty(pairs) check on handleRatesResponse in rate-fetcher
  let pairsReturned = false;

  /**
   * Use JSON Body parser...
   */
  app.use(express.json({ strict: false }));

  app.get('/tokens', (req, res) => {
    return res.status(200).json(tokens);
  });

  app.get('/pairs', (req, res) => {
    pairsReturned = true;
    return res.status(200).json(pairs);
  });

  app.get('/prices', async (req, res) => {
    if (!pairsReturned) {
      // sleep for 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return res.status(200).json(prices);
  });

  app.get('/blacklist', (req, res) => {
    return res.status(200).json(blacklist);
  });

  const fetcher = constructAxiosFetcher(axios);

  const contractCaller = constructEthersContractCaller(
    {
      ethersProviderOrSigner: account,
      EthersContract: ethers.Contract,
    },
    account.address,
  );

  const paraSwapLimitOrderSDK = constructPartialSDK(
    {
      chainId: 1,
      fetcher,
      contractCaller,
    },
    constructBuildLimitOrder,
    constructSignLimitOrder,
  );

  app.post('/firm', async (req, res) => {
    const payload: RFQPayload = req.body;

    payload.makerAsset = payload.makerAsset.toLowerCase();
    payload.takerAsset = payload.takerAsset.toLowerCase();

    const makerAssetSymbol = addressToTokenMap[payload.makerAsset].symbol!;
    const takerAssetSymbol = addressToTokenMap[payload.takerAsset].symbol!;

    let reversed = false;

    let value = new BigNumber('0');

    if (payload.makerAmount) {
      // buy
      let _prices: PairPriceResponse =
        prices.prices[`${makerAssetSymbol}/${takerAssetSymbol}`];
      if (!_prices) {
        _prices = prices.prices[`${takerAssetSymbol}/${makerAssetSymbol}`];
        reversed = true;
      }
      if (!reversed) {
        value = new BigNumber(payload.makerAmount).times(
          new BigNumber(_prices.asks![0][0]),
        );
      } else {
        const reversedPrices = _prices.asks!.map(price =>
          reversePrice([new BigNumber(price[0]), new BigNumber(price[1])]),
        );
        value = new BigNumber(payload.makerAmount).times(
          new BigNumber(reversedPrices[0][0]),
        );
      }
    } else if (payload.takerAmount) {
      // sell
      let _prices: PairPriceResponse =
        prices.prices[`${takerAssetSymbol}/${makerAssetSymbol}`];

      if (!_prices) {
        _prices = prices.prices[`${makerAssetSymbol}/${takerAssetSymbol}`];
        reversed = true;
      }
      if (!reversed) {
        value = new BigNumber(payload.takerAmount).times(
          new BigNumber(_prices.bids![0][0]),
        );
      } else {
        const reversedPrices = _prices.bids!.map(price =>
          reversePrice([new BigNumber(price[0]), new BigNumber(price[1])]),
        );
        value = new BigNumber(payload.takerAmount).times(
          new BigNumber(reversedPrices[0][0]),
        );
      }
    }

    const order = {
      maker: account.address,
      taker: payload.userAddress,
      expiry: 0,
      makerAsset: payload.makerAsset,
      takerAsset: payload.takerAsset,
      makerAmount: payload.makerAmount ? payload.makerAmount : value.toFixed(0),
      takerAmount: payload.takerAmount ? payload.takerAmount : value.toFixed(0),
    };

    console.log(order, 'reversed:', reversed);
    const signableOrderData = await paraSwapLimitOrderSDK.buildLimitOrder(
      order,
    );

    // to prevent overwriting taker to augustus v5
    signableOrderData.data.taker = payload.takerAddress;

    const signature = await paraSwapLimitOrderSDK.signLimitOrder(
      signableOrderData,
    );
    const orderToPostToApi: LimitOrderToSend = {
      ...signableOrderData.data,
      signature,
    };

    return res.status(200).json({
      order: orderToPostToApi,
    });
  });

  const server = app.listen(parseInt(process.env.TEST_PORT!, 10));
  return () => {
    server.close();
  };
};
