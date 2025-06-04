import { defaultAbiCoder } from '@ethersproject/abi';
import { getAddress as ethersGetAddress } from '@ethersproject/address';
import { keccak256 } from '@ethersproject/keccak256';
import { Token } from '../../types';
// import { Currency, Token } from '@uniswap/sdk-core';

// import { FWTokenMapping } from '../routers/fw-token-types';

// import { getAddress } from './addresses';
import {
  FEW_WRAPPED_TOKEN_BYTECODE,
  FEW_WRAPPED_TOKEN_FACTORY_ADDRESS,
} from './fewToken';

export declare const ADDRESS_ZERO =
  '0x0000000000000000000000000000000000000000';

// export function getAddressLowerCase(currency: Currency): string {
//   if (currency.isToken) {
//     return currency.address.toLowerCase();
//   } else {
//     return ADDRESS_ZERO;
//   }
// }

export function getAddress(currency: Token): string {
  // if (currency.isToken) {
  return currency.address;
  // } else {
  //   return ADDRESS_ZERO;
  // }
}

/**
 * Calculate the address of an FW token using CREATE2
 * @param originalAddress Original token address
 * @param chainId The chain ID
 * @returns FW token address
 */
export function computeFWTokenAddress(
  originalAddress: string,
  chainId: number,
): string {
  const constructorArgumentsEncoded = defaultAbiCoder.encode(
    ['address'],
    [originalAddress],
  );
  const create2Inputs = [
    '0xff',
    FEW_WRAPPED_TOKEN_FACTORY_ADDRESS(chainId),
    // salt
    keccak256(constructorArgumentsEncoded),
    // init code. bytecode + constructor arguments
    keccak256(FEW_WRAPPED_TOKEN_BYTECODE(chainId)),
  ];
  const sanitizedInputs = `0x${create2Inputs.map(i => i.slice(2)).join('')}`;
  return ethersGetAddress(`0x${keccak256(sanitizedInputs).slice(-40)}`);
}

/**
 * Check if a token is an FW token
 * @param token Token to check
 * @returns Whether it is an FW token
 */
export function isFWToken(token: Token): boolean {
  const isFwSymbol = token.symbol?.startsWith('fw') ?? false;
  return isFwSymbol;
}

/**
 * Get the corresponding FW token for an original token
 * @param token Original token
 * @returns Corresponding FW token
 */
export function getFWTokenForToken(token: Token, chainId: number): Token {
  // If not a Token type, return null

  // If it's already an FW token, return it as is
  if (isFWToken(token as Token)) {
    return token as Token;
  }

  const originalAddress = getAddress(token);
  // Calculate FW token address
  const fwAddress = computeFWTokenAddress(originalAddress, chainId);

  // Create new FW token, maintaining the same decimals and other information
  return {
    // chainId: token.chainId,
    address: fwAddress,
    decimals: token.decimals,
    symbol: `fw${token.symbol}`, // Prefix with fw (lowercase)
    type: undefined,
    // name: `Few Wrapped ${token.name}` // Prefix with "Few Wrapped"
  };
}

/**
 * Check if a path contains any FW tokens
 * @param tokens Array of tokens in the path
 * @returns Whether the path contains any FW tokens
 */
// export function pathContainsFWTokens(tokens: Token[]): boolean {
//   return tokens.some(token => isFWToken(token));
// }

/**
 * Get a mapping from original token addresses to their FW tokens
 * @param tokens Array of tokens to check
 * @returns Mapping from original address to FW token
 */
/**
export function getFWTokenMapping(tokens: Token[]): FWTokenMapping {
  const mapping: FWTokenMapping = {};
  
  for (const token of tokens) {
    if (isFWToken(token)) {
      // For FW tokens, try to reverse engineer the original address
      // This is an approximation and may need to be refined for actual implementation
      const originalAddressName = token.name?.replace('Few Wrapped ', '') || '';
      const originalAddressSymbol = token.symbol?.replace('fw', '') || '';
      
      // Try to find the original token in our tokens array
      const possibleOriginal = tokens.find(t => 
        (t.name === originalAddressName || t.symbol === originalAddressSymbol) && 
        !isFWToken(t)
      );
      
      if (possibleOriginal) {
        mapping[possibleOriginal.address] = token;
      }
    }
  }
  
  return mapping;
}
*/

/**
 * Get the original token for an FW token or vice versa
 * @param currency Currency to convert (can be original or FW token)
 * @param toFW If true, convert to FW token; if false, convert to original token
 * @returns Equivalent token (original or FW) or null if not convertible
 */
// export function getOriginalOrFWToken(currency: Currency, toFW: boolean): Currency | null {
//   // If not a Token type, return null
//   if (!(currency instanceof Token)) {
//     return null;
//   }

//   const token = currency as Token;

//   // If requested FW and already FW, or requested original and already original, return as is
//   if ((toFW && isFWToken(token)) || (!toFW && !isFWToken(token))) {
//     return token;
//   }

//   if (toFW) {
//     // Convert original to FW
//     return getFWTokenForToken(token);
//   } else {
//     // Try to convert FW to original - this is an approximation
//     // In a real implementation, you might want to maintain a reverse mapping
//     // or use a more deterministic approach
//     const originalSymbol = token.symbol?.replace('fw', '') || '';
//     const originalName = token.name?.replace('Few Wrapped ', '') || '';

//     // Return a new token with the original properties
//     // Note: This is just a placeholder. In a real implementation,
//     // you would need to determine the actual original token address
//     return new Token(
//       token.chainId,
//       token.address,
//       token.decimals,
//       originalSymbol,
//       originalName
//     );
//   }
// }
