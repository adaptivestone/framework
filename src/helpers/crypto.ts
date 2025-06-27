import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import type authConfig from '../config/auth.ts';
import { appInstance } from './appInstance.ts';

export const scryptAsync = promisify<
  string | Buffer | DataView,
  string | Buffer | DataView,
  number,
  Buffer
>(scrypt);

export const scryptAsyncWithSalt = async (stringToHash: string) => {
  const { saltSecret, hashRounds } = appInstance.getConfig(
    'auth',
  ) as typeof authConfig;
  if (!saltSecret) {
    throw new Error(
      'saltSecret should be seted up. AUTH_SALT is not defined. You can "npm run cli generateRandomBytes" and use it',
    );
  }
  const res = await scryptAsync(stringToHash, saltSecret, hashRounds);

  return res;
};

export const scryptAsyncWithSaltAsString = async (stringToHash: string) => {
  const res = await scryptAsyncWithSalt(stringToHash);
  return res.toString('base64url');
};
