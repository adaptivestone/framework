/**
 * Whether starting the HTTP server computes the login-timing hash
 * (`auth.precomputeLoginTimingHash`). Needs `mock.module()`, so the Bun run
 * skips this file.
 */
import http from 'node:http';
import { beforeEach, describe, it, mock } from 'node:test';
import authConfig from '../../config/auth.ts';
import { assertCalledTimes, assertNotCalled } from '../../tests/assertions.ts';

// A call-through spy: the hash itself stays real.
const cryptoHelpers = await import('../../helpers/crypto.ts');
const warmPasswordVerify = mock.fn(cryptoHelpers.warmPasswordVerify);
mock.module('../../helpers/crypto.ts', {
  exports: { ...cryptoHelpers, warmPasswordVerify },
});
// A fresh copy of the module, so it imports the spy whether or not the test
// server loaded `HttpServer.ts` first.
const httpServerModule = './HttpServer.ts?timing-hash';
const { default: HttpServer } = (await import(
  httpServerModule
)) as typeof import('./HttpServer.ts');

/** Start listening on a free port with the given `auth` config, then close. */
const listenWith = async (auth: Record<string, unknown>) => {
  const httpServer = http.createServer();
  const server = {
    app: {
      getConfig: (name: string) =>
        name === 'auth' ? auth : { port: 0, hostname: '127.0.0.1' },
      updateConfig: () => {},
    },
    httpServer,
  };
  try {
    await HttpServer.prototype.listen.call(
      server as unknown as InstanceType<typeof HttpServer>,
    );
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
};

describe('HttpServer.listen — login-timing hash', () => {
  beforeEach(() => {
    warmPasswordVerify.mock.resetCalls();
  });

  it('computes the hash on start by default', async () => {
    await listenWith(authConfig);

    assertCalledTimes(warmPasswordVerify, 1);
  });

  it('computes it for an app auth config written without the key', async () => {
    const { precomputeLoginTimingHash, ...appAuth } = authConfig;

    await listenWith(appAuth);

    assertCalledTimes(warmPasswordVerify, 1);
  });

  it('skips it when precomputeLoginTimingHash is false', async () => {
    await listenWith({ ...authConfig, precomputeLoginTimingHash: false });

    assertNotCalled(warmPasswordVerify);
  });
});
