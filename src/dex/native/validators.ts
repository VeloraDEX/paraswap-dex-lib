import joi from 'joi';
import { addressSchema } from '../generic-rfq/validators';

const blacklistEntryValidator = joi.object({
  id: joi.string().min(0).required(),
  address: addressSchema.required(),
  chainId: joi.number().integer().min(1).required(),
  createTime: joi.number().integer().min(0).required(),
});

export const blacklistResponseValidator = joi.object({
  black_list: joi.array().items(blacklistEntryValidator).required(),
});
