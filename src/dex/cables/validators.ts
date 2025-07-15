import joi from 'joi';

const pairValidator = joi.object({
  base: joi.string().min(1),
  quote: joi.string().min(1),
  liquidityUSD: joi.number().min(0),
  baseAddress: joi.string().min(1),
  quoteAddress: joi.string().min(1),
  baseDecimals: joi.number().min(0),
  quoteDecimals: joi.number().min(0),
});

const pairMap = joi.object().pattern(
  joi.string(), // Pair name ETH/USDT
  pairValidator,
);

export const pairsResponseValidator = joi.object({
  pairs: joi.object().pattern(
    joi.string(), // chain id
    pairMap,
  ),
});

const orderbookEntry = joi.array().items(joi.string().min(1)).length(2);

const orderbookValidator = joi.object({
  bids: joi.array().items(orderbookEntry),
  asks: joi.array().items(orderbookEntry),
});

const chainDataSchema = joi.object().pattern(
  joi.string(), // pair name USDC/USDT
  orderbookValidator,
);

export const pricesResponseValidator = joi.object({
  prices: joi.object().pattern(
    joi.string(), // chain id
    chainDataSchema,
  ),
});

const tokenValidator = joi.object({
  symbol: joi.string().min(1),
  name: joi.string().min(1),
  description: joi.string().min(1),
  address: joi.string().min(1),
  decimals: joi.number().min(0),
  type: joi.string().min(1),
});

const chainTokens = joi.object().pattern(joi.string(), tokenValidator);

export const tokensResponseValidator = joi.object({
  tokens: joi.object().pattern(joi.string(), chainTokens),
});

export const blacklistResponseValidator = joi.object({
  blacklist: joi.array().items(joi.string().min(1)),
});
