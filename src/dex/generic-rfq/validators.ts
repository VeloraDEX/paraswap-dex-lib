import BigNumber from 'bignumber.js';
import joi, { CustomHelpers, ErrorReport } from 'joi';
import * as ethers from 'ethers';

const tokensType = ['ERC20'];

export const tokenValidator = joi.object({
  symbol: joi.string().min(1).required(),
  name: joi.string().min(1).required(),
  address: joi.string().min(1).required(),
  description: joi.string(),
  decimals: joi.number().min(1).required(),
  type: joi
    .string()
    .valid(...tokensType)
    .required(),
});

export const tokensResponseValidator = joi.object({
  tokens: joi.object().pattern(joi.string().min(1), tokenValidator),
});

export const pairValidator = joi.object({
  base: joi.string().min(1).required(),
  quote: joi.string().min(1).required(),
  liquidityUSD: joi.number().min(0).required(),
});

export const pairsResponseValidator = joi.object({
  pairs: joi.object().pattern(joi.string(), pairValidator),
});

const stringNumberValidator = (
  value: string,
  helpers: CustomHelpers,
): string | ErrorReport => {
  const bn = new BigNumber(value);
  if (bn.toString() === 'NaN') {
    return helpers.message({
      custom: `${value} is not a number`,
    });
  }

  return value;
};

const pricesValidator = joi
  .array()
  .items(
    joi
      .array()
      .items(joi.string().min(1).custom(stringNumberValidator))
      .length(2),
  );

const ext: joi.Extension = {
  type: 'validatedPrices',
  base: joi.object({
    bids: pricesValidator,
    asks: pricesValidator,
  }),
  rules: {
    bidsLowerThanAsks: {
      validate: (
        values: { bids: string[]; asks: string[] },
        helpers: CustomHelpers,
      ) => {
        if (
          !values.bids ||
          !values.asks ||
          values.bids.length === 0 ||
          values.asks.length === 0
        ) {
          return values;
        }
        const maxBid = values.bids
          .map(numbers => new BigNumber(numbers[0]))
          .reduce(
            (previousValue, currentValue) =>
              currentValue.gte(previousValue) ? currentValue : previousValue,
            new BigNumber(0),
          );
        const minAsk = values.asks
          .map(numbers => new BigNumber(numbers[0]))
          .reduce(
            (previousValue, currentValue) =>
              currentValue.lte(previousValue) ? currentValue : previousValue,
            new BigNumber('123456789012345678901234567890'),
          );
        return maxBid.lt(minAsk)
          ? values
          : helpers.message({
              custom: 'the maximum bid is higher than minimum ask',
            });
      },
    },
  },
};

export const priceValidator = joi.extend(ext);

export const pricesResponse = joi.object({
  prices: joi
    .object()
    .pattern(
      joi.string().min(1),
      priceValidator.validatedPrices().bidsLowerThanAsks(),
    ),
});

export const addressSchema = joi.string().custom((value, helpers) => {
  if (ethers.utils.isAddress(value)) {
    return value.toLowerCase();
  }
  return helpers.message({ custom: `'${value}' is not valid address` });
});

export const blacklistResponseValidator = joi.object({
  blacklist: joi.array().items(addressSchema),
});

const stringPositiveBigIntValidator = (
  value: string,
  helpers: CustomHelpers,
): string | ErrorReport => {
  try {
    const val = BigInt(value);
    if (val < 0) {
      return helpers.message({ custom: `${value} is < 0` });
    }
    return value;
  } catch (e) {
    return helpers.message({
      custom: `${value} is not castable to BigInt`,
    });
  }
};

const stringStartWithHex0x = (
  value: string,
  helpers: CustomHelpers,
): string | ErrorReport => {
  if (!value.startsWith('0x')) {
    return helpers.message({
      custom: `${value} is not castable to BigInt`,
    });
  }

  return value;
};

export const orderWithSignatureValidator = joi
  .object({
    nonceAndMeta: joi.string().custom(stringPositiveBigIntValidator),
    expiry: joi.number().min(0),
    maker: addressSchema.required(),
    taker: addressSchema.required(),
    makerAsset: addressSchema.required(),
    takerAsset: addressSchema.required(),
    makerAmount: joi
      .string()
      .min(1)
      .custom(stringPositiveBigIntValidator)
      .required(),
    takerAmount: joi
      .string()
      .min(1)
      .custom(stringPositiveBigIntValidator)
      .required(),
    signature: joi.string().custom(stringStartWithHex0x),
  })
  .unknown(true);

export const firmRateResponseValidator = joi
  .object({
    order: orderWithSignatureValidator.required(),
  })
  .unknown(true);

export const firmRateWithTakerValidator = (taker: string) =>
  firmRateResponseValidator.fork(['order.taker'], _ =>
    _.required().custom((val, helpers) => {
      const { value } = addressSchema.validate(val);
      if (value !== taker.toLowerCase())
        return helpers.message({ custom: `taker must be ${taker}` });

      return value;
    }),
  );
