import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { Response } from 'express';
import type { PostLoginRequest } from '../../controllers/Auth.routes.gen.ts';
import Auth from '../../controllers/Auth.ts';
import Health from '../../controllers/Health.ts';
import Home from '../../controllers/Home.ts';
import type { IApp } from '../../server.ts';
import type { FrameworkRequest } from './HttpServer.ts';
import { HttpResponse } from './responses.ts';
import { createExpressAdapter } from './routing/ExpressAdapter.ts';
import type { HandlerEntry, HttpMethod } from './routing/RouteNode.ts';
import { RouteRegistry } from './routing/RouteRegistry.ts';

const app = {
  getModel: () => ({
    getUserByEmailAndPassword: async (email: string) => {
      assert.strictEqual(email, 'person@example.com');
      return {
        isVerified: true,
        generateToken: async () => 'session',
        getPublic: () => ({ email }),
      };
    },
  }),
  getConfig: (section: string) =>
    section === 'health' ? { token: 'required' } : {},
} as unknown as IApp;

async function dispatch(method: HttpMethod, handler: HandlerEntry['handler']) {
  const path = '/';
  const registry = new RouteRegistry();
  registry.registerRoute(method, path, { handler });
  const res = { statusCode: 200, headersSent: false } as Response;
  const req = {
    method,
    path,
    res,
    headers: {},
    query: {},
    appInfo: { request: { email: 'PERSON@example.com', password: 'stub' } },
  } as unknown as FrameworkRequest;
  const written: HttpResponse[] = [];
  const adapter = createExpressAdapter(registry, app, {
    async write(response) {
      written.push(response);
    },
  });
  await adapter(req, res, (err) => {
    if (err) {
      throw err;
    }
  });
  return written;
}

it('bridges an Auth override that passes a copied request and returns res', async () => {
  class AppAuth extends Auth {
    override async postLogin(req: PostLoginRequest, res: Response) {
      const forwarded = {
        ...req,
        appInfo: {
          ...req.appInfo,
          request: {
            ...req.appInfo.request,
            email: req.appInfo.request.email.toLowerCase(),
          },
        },
      };
      delete forwarded.res;
      await super.postLogin(forwarded, res);
      return res;
    }
  }
  const auth = new AppAuth(app, '');
  const written = await dispatch('POST', auth.postLogin.bind(auth));
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, {
      data: { token: 'session', user: { email: 'person@example.com' } },
    }),
  ]);
});

it('still bridges a Home response without an Express response argument', async () => {
  const home = new Home(app, '');
  const written = await dispatch(
    'GET',
    async (req: FrameworkRequest, res: Response) => {
      await home.home(req);
      return res;
    },
  );
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, { message: 'Home' }),
  ]);
});

it('claims one late response across the Express response and request keys', async () => {
  const health = new Health(app, '');
  const home = new Home(app, '');
  const ready = Promise.withResolvers<void>();
  let work: Promise<void> | undefined;
  const written = await dispatch(
    'GET',
    (req: FrameworkRequest, res: Response) => {
      const forwarded = Object.assign({}, req);
      delete forwarded.res;
      work = ready.promise.then(async () => {
        await health.live(forwarded, res);
        assert.strictEqual(res.statusCode, 401);
        await home.home(req);
      });
      return res;
    },
  );

  assert.deepStrictEqual(written, []);
  ready.resolve();
  await work;
  await setImmediate();
  assert.deepStrictEqual(written, [
    HttpResponse.json(401, { message: 'Unauthorized' }),
  ]);
});
