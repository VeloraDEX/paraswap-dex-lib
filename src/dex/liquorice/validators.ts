import joi from 'joi';
import { addressSchema } from '../generic-rfq/validators';

const positiveDecimal = joi
  .string()
  .pattern(/^\d+(\.\d+)?(e[-+]?\d+)?$/i)
  .custom((value, helpers) =>
    Number(value) > 0 ? value : helpers.error('any.invalid'),
  );

const curveValidator = joi.object({
  minAmount: positiveDecimal.required(),
  levels: joi
    .array()
    .items(joi.array().ordered(positiveDecimal, positiveDecimal).length(2))
    .min(1)
    .required(),
});

export const pricesResponseValidator = joi.object({
  updatedAt: joi.number().required(),
  pairs: joi
    .object()
    .pattern(
      joi.string().pattern(/^0x[0-9a-f]{40}_0x[0-9a-f]{40}$/),
      joi.object({ curves: joi.array().items(curveValidator).required() }),
    )
    .required(),
});

export const tokensResponseValidator = joi.object({
  tokens: joi
    .array()
    .items(
      joi.object({
        address: addressSchema.required(),
        symbol: joi.string().allow('').required(),
        decimals: joi.number().integer().min(0).max(36).required(),
      }),
    )
    .required(),
});

export const blacklistResponseValidator = joi.object({
  addresses: joi.array().items(addressSchema).required(),
});
