import BigNumber from 'bignumber.js';
import joi, { CustomHelpers, ErrorReport } from 'joi';
import * as ethers from 'ethers';
import { SwaapV2PriceLevel } from './types';

const priceLevelsValidator = joi.array().items(
  joi.object({
    level: joi.number().required(),
    price: joi.number().required(),
  }),
);

const ext: joi.Extension = {
  type: 'validatedpriceLevels',
  base: joi.object({
    bids: priceLevelsValidator,
    asks: priceLevelsValidator,
    liquidity_USD: joi.number(),
  }),
  rules: {
    bidsLowerThanAsks: {
      validate: (
        values: { bids: SwaapV2PriceLevel[]; asks: SwaapV2PriceLevel[] },
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
          .map(pl => new BigNumber(pl.price))
          .reduce(
            (previousValue, currentValue) =>
              currentValue.gte(previousValue) ? currentValue : previousValue,
            new BigNumber(0),
          );
        const minAsk = values.asks
          .map(pl => new BigNumber(pl.price))
          .reduce(
            (previousValue, currentValue) =>
              currentValue.lte(previousValue) ? currentValue : previousValue,
            new BigNumber('123456789012345678901234567890'),
          );
        return maxBid.lte(minAsk)
          ? values
          : helpers.message({
              custom: 'the maximum bid is higher than minimum ask',
            });
      },
    },
  },
};

export const priceLevelsResponseValidator = joi.object({
  levels: joi
    .object()
    .pattern(
      joi.string().min(1),
      joi.extend(ext).validatedpriceLevels().bidsLowerThanAsks(),
    ),
  success: joi.boolean().required(),
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

export const getTokensResponseValidator = joi.object({
  tokens: joi.object().required(),
  success: joi.boolean().required(),
});

export const getQuoteResponseValidator = joi
  .object({
    id: joi.string().required(),
    recipient: addressSchema.required(),
    expiration: joi.number().min(0),
    amount: joi
      .string()
      .min(0)
      .custom(stringPositiveBigIntValidator)
      .required(),
    calldata: joi.string().required(),
    success: joi.boolean().required(),
  })
  .unknown(true);

export const notifyResponseValidator = joi
  .object({
    success: joi.boolean().required(),
  })
  .unknown(true);

export const getQuoteResponseWithRecipientValidator = (recipient: string) =>
  getQuoteResponseValidator.fork(['recipient'], _ =>
    _.required().custom((val, helpers) => {
      const { value } = addressSchema.validate(val);
      if (value !== recipient.toLowerCase())
        return helpers.message({ custom: `recipient must be ${recipient}` });

      return value;
    }),
  );
