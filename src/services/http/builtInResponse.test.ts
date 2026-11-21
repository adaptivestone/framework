import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import type { Response } from 'express';
import type { PostLoginRequest } from '../../controllers/Auth.routes.gen.ts';
import Auth from '../../controllers/Auth.ts';
import Health from '../../controllers/Health.ts';
import Home from '../../controllers/Home.ts';
import type { IApp } from '../../server.ts';
import { builtInResponse } from './builtInResponse.ts';
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
  const res = {
    statusCode: 200,
    headersSent: false,
    on() {},
    off() {},
  } as unknown as Response;
  const req = {
    method,
    path,
    res,
    headers: {},
    query: {},
    appInfo: { request: { email: 'PERSON@example.com', password: 'stub' } },
  } as unknown as FrameworkRequest;
  Object.assign(res, { req });
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

it('still bridges a Home response without a res argument', async () => {
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

it('claims one late response across the res and request keys', async () => {
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

it('claims a late response the handler gets with the request only', async () => {
  const home = new Home(app, '');
  const ready = Promise.withResolvers<void>();
  let work: Promise<unknown> | undefined;
  const written = await dispatch('GET', (req: FrameworkRequest) => {
    work = ready.promise.then(() => home.home(req));
  });

  assert.deepStrictEqual(written, []);
  ready.resolve();
  await work;
  await setImmediate();
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, { message: 'Home' }),
  ]);
});

it('bridges an awaited response passed a wrapper of res', async () => {
  const health = new Health(app, '');
  let status: number | undefined;
  const written = await dispatch(
    'GET',
    async (req: FrameworkRequest, res: Response) => {
      await health.live(req, Object.create(res));
      status = res.statusCode;
    },
  );
  assert.deepStrictEqual(written, [
    HttpResponse.json(401, { message: 'Unauthorized' }),
  ]);
  assert.strictEqual(status, 401);
});

it('claims a late response passed a wrapper of res', async () => {
  const health = new Health(app, '');
  const ready = Promise.withResolvers<void>();
  let work: Promise<number> | undefined;
  const written = await dispatch(
    'GET',
    (req: FrameworkRequest, res: Response) => {
      work = ready.promise.then(async () => {
        await health.live(req, Object.create(res));
        return res.statusCode;
      });
    },
  );

  assert.deepStrictEqual(written, []);
  ready.resolve();
  const status = await work;
  await setImmediate();
  assert.deepStrictEqual(written, [
    HttpResponse.json(401, { message: 'Unauthorized' }),
  ]);
  assert.strictEqual(status, 401);
});

it('bridges a response passed a copied request and a wrapper of res', async () => {
  const home = new Home(app, '');
  const written = await dispatch(
    'GET',
    async (req: FrameworkRequest, res: Response) => {
      await home.home(Object.assign({}, req), Object.create(res));
    },
  );
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, { message: 'Home' }),
  ]);
});

it('claims a late response passed a copied request and a wrapper of res', async () => {
  const home = new Home(app, '');
  const ready = Promise.withResolvers<void>();
  let work: Promise<unknown> | undefined;
  const written = await dispatch(
    'GET',
    (req: FrameworkRequest, res: Response) => {
      work = ready.promise.then(() =>
        home.home(Object.assign({}, req), Object.create(res)),
      );
    },
  );

  assert.deepStrictEqual(written, []);
  ready.resolve();
  await work;
  await setImmediate();
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, { message: 'Home' }),
  ]);
});

it('bridges a response passed a copied request without res and a wrapper of res', async () => {
  const home = new Home(app, '');
  const written = await dispatch(
    'GET',
    async (req: FrameworkRequest, res: Response) => {
      const forwarded = Object.assign({}, req);
      delete forwarded.res;
      await home.home(forwarded, Object.create(res));
    },
  );
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, { message: 'Home' }),
  ]);
});

it('shows the status on res when passed a copied request without res and a wrapper of res', async () => {
  const health = new Health(app, '');
  let status: number | undefined;
  const written = await dispatch(
    'GET',
    async (req: FrameworkRequest, res: Response) => {
      const forwarded = Object.assign({}, req);
      delete forwarded.res;
      await health.live(forwarded, Object.create(res));
      status = res.statusCode;
    },
  );
  assert.deepStrictEqual(written, [
    HttpResponse.json(401, { message: 'Unauthorized' }),
  ]);
  assert.strictEqual(status, 401);
});

it('claims a late response passed a copied request without res and a wrapper of res', async () => {
  const home = new Home(app, '');
  const ready = Promise.withResolvers<void>();
  let work: Promise<unknown> | undefined;
  const written = await dispatch(
    'GET',
    (req: FrameworkRequest, res: Response) => {
      const forwarded = Object.assign({}, req);
      delete forwarded.res;
      work = ready.promise.then(() => home.home(forwarded, Object.create(res)));
    },
  );

  assert.deepStrictEqual(written, []);
  ready.resolve();
  await work;
  await setImmediate();
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, { message: 'Home' }),
  ]);
});

it('delivers the response when the wrapper of res has a read-only status', async () => {
  const home = new Home(app, '');
  const written = await dispatch(
    'GET',
    (req: FrameworkRequest, res: Response) =>
      home.home(
        req,
        Object.create(res, { statusCode: { get: () => res.statusCode } }),
      ),
  );
  assert.deepStrictEqual(written, [
    HttpResponse.json(200, { message: 'Home' }),
  ]);
});

it('shares a recorded response between copies of the module', async () => {
  // A real second copy of the module file, as a package bundling its own has.
  const dir = await mkdtemp(join(tmpdir(), 'bridge-copy-'));
  try {
    const copy = join(dir, 'builtInResponse.ts');
    await copyFile(new URL('./builtInResponse.ts', import.meta.url), copy);
    const second = (await import(
      pathToFileURL(copy).href
    )) as typeof import('./builtInResponse.ts');
    assert.notStrictEqual(second.builtInResponse, builtInResponse);
    const req = {};
    const res = { statusCode: 200, headersSent: false };
    const response = HttpResponse.json(200, { message: 'Home' });
    builtInResponse(req, response, res);
    const sent: HttpResponse[] = [];
    second.claimBuiltInResponse(req, res, (dropped) => sent.push(dropped));
    assert.deepStrictEqual(sent, [response]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
