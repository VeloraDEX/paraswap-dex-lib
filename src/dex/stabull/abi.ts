import { Interface } from '@ethersproject/abi';
import poolAbi from '../../abi/stabull/pool.json';
import assimilatorAbi from '../../abi/stabull/assimilator.json';
import factoryAbi from '../../abi/stabull/factory.json';
import configAbi from '../../abi/stabull/config.json';

export const poolInterface = new Interface(poolAbi);
export const assimilatorInterface = new Interface(assimilatorAbi);
export const factoryInterface = new Interface(factoryAbi);
export const configInterface = new Interface(configAbi);
