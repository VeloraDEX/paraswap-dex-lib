import joi from 'joi';
import protobuf from 'protobufjs';
import JSONDescriptor from './bebop.json';

const levelValidator = joi.array().items(joi.number()).length(2);

const pairValidator = joi.object({
  bids: joi.array().items(levelValidator).required(),
  asks: joi.array().items(levelValidator).required(),
  last_update_ts: joi.number().min(0).required(),
});

export const pricesResponseValidator = joi
  .object()
  .pattern(joi.string(), pairValidator);

const tokenValidator = joi
  .object({
    ticker: joi.string().min(1).required(),
    contractAddress: joi.string().min(1).required(),
    decimals: joi.number().min(0).required(),
  })
  .unknown(true);

export const tokensResponseValidator = joi.object({
  tokens: joi.object().pattern(joi.string(), tokenValidator),
});

export const blacklistResponseValidator = joi.object({
  blacklist: joi.array().items(joi.string().min(1)).required(),
});

// Original .proto def
// const root = protobuf.loadSync(__dirname + '/bebop.proto');
// Use .json to not change build step to include .proto files
// console.log(JSON.stringify(root.toJSON(), null, 4));

const root = protobuf.Root.fromJSON(JSONDescriptor);
export const BebopPricingUpdate = root.lookupType('bebop.BebopPricingUpdate');
