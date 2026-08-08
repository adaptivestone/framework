import { appInstance } from '../helpers/appInstance.ts';
import type UserModel from '../models/User.ts';
import type { TUser } from '../models/User.ts';
import type { GetModelTypeFromClass } from '../modules/BaseModel.ts';
import type Server from '../server.ts';
import type { ServerOptions } from '../server.ts';

/**
 * Server options a project can declare for the test server the shipped setup
 * boots. `folders` is excluded — the bootstrap resolves those itself from the
 * `TEST_FOLDER_*` env vars.
 */
export type TestServerOptions = Omit<ServerOptions, 'folders'>;

let testServerOptions: TestServerOptions = {};
let areTestServerOptionsApplied = false;

/**
 * Declare `Server` options — notably the `bootHttp` hook — for the test server.
 * Without this, app-wide HTTP wiring that production does in `bootHttp` is
 * simply absent under test, so tests see the unwired behavior (a 500 where
 * production returns the mapped status) with nothing reporting the difference.
 *
 * Call it at module scope in the preload that imports the framework setup glue,
 * before any hook boots the server.
 */
export const configureTestServer = (options: TestServerOptions) => {
  if (areTestServerOptionsApplied) {
    throw new Error(
      'configureTestServer() must be called before the test server boots. ' +
        'Call it at module scope in your test preload (the module that imports ' +
        '@adaptivestone/framework/tests/setupNodeTest.js), not from a test hook.',
    );
  }
  testServerOptions = { ...testServerOptions, ...options };
};

/**
 * Read the declared options and close the window for further configuration.
 * Called once by the test bootstrap as it constructs the `Server`.
 */
export const takeTestServerOptions = (): TestServerOptions => {
  areTestServerOptionsApplied = true;
  return testServerOptions;
};

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
