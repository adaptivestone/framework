import { scrypt } from 'node:crypto';

import { promisify } from 'node:util';

import { appInstance } from './appInstance.ts';

export const scryptAsync = promisify<
  string | Buffer | DataView,
  string | Buffer | DataView,
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
