import { appInstance } from '../helpers/appInstance.ts';
import type UserModel from '../models/User.ts';
import type { TUser } from '../models/User.ts';
import type { GetModelTypeFromClass } from '../modules/BaseModel.ts';
import type Server from '../server.ts';

export let serverInstance!: Server;
export let defaultUser: InstanceType<GetModelTypeFromClass<typeof UserModel>>;
export let defaultAuthToken: string;

export const setServerInstance = (serverInstanceToSet: Server) => {
  if (serverInstance) {
    throw new Error('Server instance is already set');
  }
  serverInstance = serverInstanceToSet;
};

export const setDefaultUser = (
  userToSet: InstanceType<GetModelTypeFromClass<typeof UserModel>>,
) => {
  if (defaultUser) {
    throw new Error('Default user is already set');
  }
  defaultUser = userToSet;
};

export const setDefaultAuthToken = (tokenToSet: string) => {
  if (defaultAuthToken) {
    throw new Error('Auth token is already set');
  }
  defaultAuthToken = tokenToSet;
};

export const getTestServerURL = (urlPart?: string) =>
  `http://127.0.0.1:${appInstance.getConfig('http').port}${urlPart}`;

let publicServerReadyPromise: Promise<Server> | null = null;

/**
 * Await the idempotent per-file server startup used by the node:test preload.
 * Call this first from an application root-level `before()` hook before using
 * `appInstance`, models, config, or the HTTP server.
 */
export function ensureTestServerReady(): Promise<Server> {
  // Lazy import avoids an eager cycle: setupFramework owns startup and imports
  // the instance setters above, while consumer tests discover this helper here.
  publicServerReadyPromise ??= import('./setupFramework.ts').then(
    ({ ensureTestServerReady: ensureReady }) => ensureReady(),
  );
  return publicServerReadyPromise;
}

export const createDefaultTestUser = async () => {
  if (defaultUser) {
    throw new Error('You already have created default user');
  }
  const User = appInstance.getModel('User') as unknown as TUser;
  const user = await User.create({
    email: 'test@test.com',
    password: 'testPassword',
    isVerified: true,
    name: {
      nick: 'testUserNickName',
    },
  }).catch((e: Error) => {
    console.error(e);
    console.info(
      'That error can happens in case you have custom user model. Please implment user creation by youself',
    );
  });
  if (!user) {
    return false;
  }
  setDefaultUser(user);
  const token = await user.generateToken();
  setDefaultAuthToken(token.token);
  return { user, token: token.token };
};
