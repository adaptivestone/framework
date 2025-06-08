import { scrypt } from 'node:crypto';

import { promisify } from 'node:util';

import { appInstance } from './appInstance.js';

export const scryptAsync = promisify<
  string | Buffer | NodeJS.TypedArray | DataView,
  string | Buffer | NodeJS.TypedArray | DataView,
  number,
  Buffer
>(scrypt);

export const scryptAsyncWithSalt = async (stringToHash: string) => {
  const { saltSecret, hashRounds } = appInstance.getConfig('auth');
  const res = await scryptAsync(stringToHash, saltSecret, hashRounds);

  return res;
};

export const scryptAsyncWithSaltAsString = async (stringToHash: string) => {
  const res = await scryptAsyncWithSalt(stringToHash);
  return res.toString('base64url');
};
