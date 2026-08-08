import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { object, string } from 'yup';
import { z } from 'zod';
import {
  assertCalled,
  assertCalledWith,
  assertContainEqual,
  assertMatches,
  assertMatchObject,
  assertNotCalled,
  assertTextMatch,
  pattern,
} from '../../tests/assertions.ts';
import Pagination from '../http/middleware/Pagination.ts';
import type { FlatRoute, MiddlewareEntry } from '../http/routing/RouteNode.ts';
import { generateOpenApi } from './OpenApiGenerator.ts';

// biome-ignore lint/suspicious/noExplicitAny: assertions read into a loosely-typed OpenAPI doc
type AnyDoc = any;

// Minimal FlatRoute factory — flatten()'s output shape is plain data.
function route(
  partial: Partial<FlatRoute> & Pick<FlatRoute, 'method' | 'path'>,
): FlatRoute {
  return {
    method: partial.method,
    path: partial.path,
    entry: partial.entry ?? { handler: () => {}, meta: {} },
    middlewares: partial.middlewares ?? [],
    bodyParsing: partial.bodyParsing ?? 'parsed',
  };
}

// Collect every operationId in the emitted document, in path/verb order.
function operationIds(doc: AnyDoc): string[] {
  const ids: string[] = [];
  for (const pathItem of Object.values(doc.paths as Record<string, AnyDoc>)) {
    for (const op of Object.values(pathItem)) {
      ids.push((op as AnyDoc).operationId);
    }
  }
  return ids;
}

// A synthetic middleware carrying a static auth scheme (read with no instance).
function authMiddleware(): MiddlewareEntry {
  const Class = {
    get usedAuthParameters() {
      return [
        {
          name: 'Authorization',
          type: 'apiKey',
          in: 'header',
          description: 'token auth',
        },
      ];
    },
  };
  return { Class: Class as unknown as MiddlewareEntry['Class'] };
}

// A synthetic middleware exposing a static, introspectable query schema.
function queryMiddleware(schema: unknown): MiddlewareEntry {
  const Class = {
    get relatedQueryParameters() {
      return schema;
    },
  };
  return { Class: Class as unknown as MiddlewareEntry['Class'] };
}

describe('generateOpenApi', () => {
  it('emits the 3.1 skeleton with info and servers', async () => {
    const doc = await generateOpenApi([], {
      info: { title: 'My API', version: '1.2.3' },
      servers: [{ url: 'http://localhost:3300', description: 'Localhost' }],
    });

    assert.strictEqual(doc.openapi, '3.1.0');
    assert.deepStrictEqual(doc.info, { title: 'My API', version: '1.2.3' });
    assert.deepStrictEqual(doc.servers, [
      { url: 'http://localhost:3300', description: 'Localhost' },
    ]);
    assert.deepStrictEqual(doc.paths, {});
  });

  it('converts :id to {id} and emits a path parameter', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/:id',
          entry: {
            handler: () => {},
            paramNames: ['id'],
            meta: { methodName: 'getItem', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const op = (doc as AnyDoc).paths['/{id}'].get;
    assert.strictEqual(op.operationId, 'Items_getItem');
    assert.deepStrictEqual(op.tags, ['Items']);
    assertContainEqual(op.parameters, {
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  });

  it('builds a request body from a yup schema', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'POST',
          path: '/',
          entry: {
            handler: () => {},
            request: object({ name: string().required(), note: string() }),
            meta: { methodName: 'create', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const schema = (doc as AnyDoc).paths['/'].post.requestBody.content[
      'application/json'
    ].schema;
    assert.strictEqual(schema.type, 'object');
    assert.deepStrictEqual(schema.properties.name, { type: 'string' });
    assert.deepStrictEqual(schema.required, ['name']);
  });

  it('emits one media type per content-type map key', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'POST',
          path: '/upload',
          entry: {
            handler: () => {},
            request: {
              'application/json': object({ url: string() }),
              'multipart/form-data': object({ caption: string() }),
            } as AnyDoc,
            meta: { methodName: 'upload', controllerClass: 'Files' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const content = (doc as AnyDoc).paths['/upload'].post.requestBody.content;
    assert.deepStrictEqual(Object.keys(content).sort(), [
      'application/json',
      'multipart/form-data',
    ]);
  });

  it('emits query parameters from a query schema', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/',
          entry: {
            handler: () => {},
            query: z.object({ page: z.string(), q: z.string().optional() }),
            meta: { methodName: 'list', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const params = (doc as AnyDoc).paths['/'].get.parameters;
    const page = params.find((p: AnyDoc) => p.name === 'page');
    const q = params.find((p: AnyDoc) => p.name === 'q');
    assertMatchObject(page, { in: 'query', required: true });
    assertMatchObject(q, { in: 'query', required: false });
  });

  it('refines path parameters from a route params schema', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/:id/:n',
          entry: {
            handler: () => {},
            paramNames: ['id', 'n'],
            params: z.object({
              id: z.string().regex(/^[0-9a-fA-F]{24}$/),
              n: z.coerce.number().min(1),
            }),
            meta: { methodName: 'getItem', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const params = (doc as AnyDoc).paths['/{id}/{n}'].get.parameters;
    const id = params.find((p: AnyDoc) => p.name === 'id');
    const n = params.find((p: AnyDoc) => p.name === 'n');

    // Path params stay `required: true` — they are part of the URL by
    // construction, whatever the schema says about optionality.
    assertMatchObject(id, { in: 'path', required: true });
    assertMatchObject(n, { in: 'path', required: true });
    // …but the SCHEMA now comes from the params validator, not a hardcoded string.
    assert.strictEqual(id.schema.pattern, '^[0-9a-fA-F]{24}$');
    assert.strictEqual(n.schema.type, 'number');
    assert.strictEqual(n.schema.minimum, 1);
  });

  it('falls back to string for a path param the params schema omits', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/:id/:extra',
          entry: {
            handler: () => {},
            paramNames: ['id', 'extra'],
            params: z.object({ id: z.string() }),
            meta: { methodName: 'getItem', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const params = (doc as AnyDoc).paths['/{id}/{extra}'].get.parameters;
    assertContainEqual(params, {
      name: 'extra',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  });

  it('warns when a params schema declares a key the path has no segment for', async () => {
    const onWarning = mock.fn();
    await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/:id',
          entry: {
            handler: () => {},
            paramNames: ['id'],
            params: z.object({ id: z.string(), typo: z.string() }),
            meta: { methodName: 'getItem', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' }, onWarning },
    );

    assertCalledWith(
      onWarning,
      pattern.stringMatching(/params schema declares "typo"/),
    );
  });

  it('emits Pagination page and limit parameters without an introspection warning', async () => {
    const onWarning = mock.fn();
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/',
          middlewares: [{ Class: Pagination }],
          entry: {
            handler: () => {},
            meta: { methodName: 'list', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' }, onWarning },
    );

    const params = (doc as AnyDoc).paths['/'].get.parameters;
    assertMatches(
      params,
      pattern.arrayContaining([
        pattern.objectContaining({
          name: 'page',
          in: 'query',
          required: false,
          schema: pattern.objectContaining({ type: 'number' }),
        }),
        pattern.objectContaining({
          name: 'limit',
          in: 'query',
          required: false,
          schema: pattern.objectContaining({ type: 'number' }),
        }),
      ]),
    );
    assertNotCalled(onWarning);
  });

  it('dedups a (name, in) collision between route and middleware query, route wins', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/',
          // Middleware also declares `limit` (as a string) — must lose to route.
          middlewares: [queryMiddleware(z.object({ limit: z.string() }))],
          entry: {
            handler: () => {},
            query: z.object({ limit: z.number() }),
            meta: { methodName: 'list', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const params = (doc as AnyDoc).paths['/'].get.parameters;
    const limits = params.filter(
      (p: AnyDoc) => p.name === 'limit' && p.in === 'query',
    );
    // Exactly one `(limit, query)` entry — OpenAPI 3.1 forbids duplicates.
    assert.strictEqual(limits.length, 1);
    // The survivor is the route's own schema (number), not the middleware's.
    assert.deepStrictEqual(limits[0].schema, { type: 'number' });
  });

  it('dedups the same middleware contributed at two mount scopes', async () => {
    // flatten() concatenates a middleware mounted at two scopes into the chain
    // twice; the same Class appears twice in `middlewares`.
    const mw = queryMiddleware(z.object({ limit: z.string() }));
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/',
          middlewares: [mw, mw],
          entry: {
            handler: () => {},
            meta: { methodName: 'list', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const params = (doc as AnyDoc).paths['/'].get.parameters;
    const limits = params.filter(
      (p: AnyDoc) => p.name === 'limit' && p.in === 'query',
    );
    assert.strictEqual(limits.length, 1);
  });

  it('collects security schemes from middleware static auth params', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/me',
          middlewares: [authMiddleware()],
          entry: {
            handler: () => {},
            meta: { methodName: 'me', controllerClass: 'Auth' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    assert.deepStrictEqual(
      (doc as AnyDoc).components.securitySchemes.Authorization,
      {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'token auth',
      },
    );
    assert.deepStrictEqual((doc as AnyDoc).paths['/me'].get.security, [
      { Authorization: [] },
    ]);
  });

  it('degrades to a placeholder + warning for an un-introspectable schema', async () => {
    const onWarning = mock.fn();
    const opaque = {
      '~standard': {
        version: 1,
        vendor: 'valibot',
        validate: () => ({ value: {} }),
      },
    } as AnyDoc;

    const doc = await generateOpenApi(
      [
        route({
          method: 'POST',
          path: '/',
          entry: {
            handler: () => {},
            request: opaque,
            meta: { methodName: 'create', controllerClass: 'Items' },
          },
        }),
      ],
      { info: { title: 't', version: '1' }, onWarning },
    );

    const schema = (doc as AnyDoc).paths['/'].post.requestBody.content[
      'application/json'
    ].schema;
    assert.strictEqual(schema.type, 'object');
    assertTextMatch(schema.description, /introspection unavailable/i);
    assertCalled(onWarning);
  });

  it('contains a throwing schema exporter to its route and keeps exporting', async () => {
    const onWarning = mock.fn();
    const broken = {
      '~standard': {
        version: 1,
        vendor: 'custom',
        validate: () => ({ value: {} }),
      },
      toJsonSchema() {
        throw new Error('deliberately unrepresentable');
      },
    } as AnyDoc;

    const doc = await generateOpenApi(
      [
        route({
          method: 'POST',
          path: '/broken',
          entry: {
            handler: () => {},
            request: broken,
            meta: { methodName: 'broken', controllerClass: 'Broken' },
          },
        }),
        route({
          method: 'POST',
          path: '/healthy',
          entry: {
            handler: () => {},
            request: z.object({ name: z.string() }),
            meta: { methodName: 'healthy', controllerClass: 'Healthy' },
          },
        }),
      ],
      { info: { title: 't', version: '1' }, onWarning },
    );

    assertMatchObject(
      (doc as AnyDoc).paths['/broken'].post.requestBody.content[
        'application/json'
      ].schema,
      {
        type: 'object',
        description: pattern.stringMatching(/introspection unavailable/i),
      },
    );
    assert.deepStrictEqual(
      (doc as AnyDoc).paths['/healthy'].post.requestBody.content[
        'application/json'
      ].schema.properties.name,
      { type: 'string' },
    );
    assertCalledWith(
      onWarning,
      pattern.stringMatching(
        /POST \/broken body: schema conversion failed.*deliberately unrepresentable/i,
      ),
    );
  });

  it('approximates a splat as a path parameter and warns', async () => {
    const onWarning = mock.fn();
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/files/*rest',
          entry: {
            handler: () => {},
            paramNames: ['rest'],
            meta: { methodName: 'serve', controllerClass: 'Files' },
          },
        }),
      ],
      { info: { title: 't', version: '1' }, onWarning },
    );

    assert.notStrictEqual(
      (doc as AnyDoc).paths['/files/{rest}'].get,
      undefined,
    );
    assertCalledWith(onWarning, pattern.stringMatching(/catch-all/i));
  });

  it('namespaces operationIds by controller and keeps them unique', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/items',
          entry: {
            handler: () => {},
            meta: { methodName: 'getList', controllerClass: 'Items' },
          },
        }),
        route({
          method: 'GET',
          path: '/users',
          entry: {
            handler: () => {},
            meta: { methodName: 'getList', controllerClass: 'Users' },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    assert.strictEqual(
      (doc as AnyDoc).paths['/items'].get.operationId,
      'Items_getList',
    );
    assert.strictEqual(
      (doc as AnyDoc).paths['/users'].get.operationId,
      'Users_getList',
    );
    assert.strictEqual(
      operationIds(doc).length,
      new Set(operationIds(doc)).size,
    );
  });

  it('disambiguates deterministically when a controller+method maps to multiple routes', async () => {
    const routes: FlatRoute[] = [
      route({
        method: 'GET',
        path: '/',
        entry: {
          handler: () => {},
          meta: { methodName: 'getList', controllerClass: 'Reports' },
        },
      }),
      route({
        method: 'GET',
        path: '/archive',
        entry: {
          handler: () => {},
          meta: { methodName: 'getList', controllerClass: 'Reports' },
        },
      }),
      route({
        method: 'POST',
        path: '/',
        entry: {
          handler: () => {},
          meta: { methodName: 'getList', controllerClass: 'Reports' },
        },
      }),
    ];
    const opts = { info: { title: 't', version: '1' } };

    const doc = await generateOpenApi(routes, opts);
    const ids = operationIds(doc);
    assert.strictEqual(ids.length, new Set(ids).size); // all unique

    // Deterministic across runs.
    const again = operationIds(await generateOpenApi(routes, opts));
    assert.deepStrictEqual(again, ids);
  });

  it('adds numeric suffixes after repeated operationId verb collisions', async () => {
    const routes = ['/one', '/two', '/three', '/four'].map((path) =>
      route({
        method: 'GET',
        path,
        entry: {
          handler: () => {},
          meta: { methodName: 'list', controllerClass: 'Reports' },
        },
      }),
    );

    assert.deepStrictEqual(
      operationIds(
        await generateOpenApi(routes, {
          info: { title: 't', version: '1' },
        }),
      ),
      [
        'Reports_list',
        'Reports_list_get',
        'Reports_list_get_2',
        'Reports_list_get_3',
      ],
    );
  });

  it('derives operationIds from the method and path when handler metadata is absent', async () => {
    const doc = await generateOpenApi(
      [
        route({ method: 'GET', path: '/' }),
        route({ method: 'POST', path: '/files/:id' }),
      ],
      { info: { title: 't', version: '1' } },
    );

    assert.deepStrictEqual(operationIds(doc), ['get_root', 'post_files_id']);
  });

  it('warns and uses safe fallbacks for opaque query and content-map schemas', async () => {
    const onWarning = mock.fn();
    const opaque = {
      '~standard': {
        version: 1,
        vendor: 'opaque',
        validate: () => ({ value: {} }),
      },
    } as AnyDoc;
    const doc = await generateOpenApi(
      [
        route({
          method: 'POST',
          path: '/opaque',
          entry: {
            handler: () => {},
            query: opaque,
            request: { 'application/custom': opaque } as AnyDoc,
            meta: { methodName: 'create', controllerClass: 'Opaque' },
          },
        }),
      ],
      { info: { title: 't', version: '1' }, onWarning },
    );

    const operation = (doc as AnyDoc).paths['/opaque'].post;
    assert.strictEqual(operation.parameters, undefined);
    assertMatchObject(
      operation.requestBody.content['application/custom'].schema,
      {
        type: 'object',
        description: pattern.stringMatching(/introspection unavailable/i),
      },
    );
    assertCalledWith(onWarning, pattern.stringContaining('query'));
    assertCalledWith(onWarning, pattern.stringContaining('application/custom'));
  });

  it('passes through custom middleware security scheme types', async () => {
    const Class = {
      get usedAuthParameters() {
        return [
          {
            name: 'PartnerOAuth',
            type: 'oauth2',
            description: 'Partner authorization',
          },
          {
            name: 'BearerAuth',
            type: 'http',
            description: 'Bearer authorization',
          },
        ];
      },
    };
    const middleware = {
      Class: Class as unknown as MiddlewareEntry['Class'],
    };
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/partner',
          middlewares: [middleware],
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    assert.deepStrictEqual(
      (doc as AnyDoc).components.securitySchemes.PartnerOAuth,
      {
        type: 'oauth2',
        description: 'Partner authorization',
      },
    );
    assert.deepStrictEqual(
      (doc as AnyDoc).components.securitySchemes.BearerAuth,
      {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer authorization',
      },
    );
  });

  it('merges introspectable middleware body fields and ignores opaque ones', async () => {
    const requestMiddleware = (schema: unknown): MiddlewareEntry => {
      const Class = {
        get relatedRequestParameters() {
          return schema;
        },
      };
      return { Class: Class as unknown as MiddlewareEntry['Class'] };
    };
    const opaque = {
      '~standard': {
        version: 1,
        vendor: 'opaque',
        validate: () => ({ value: {} }),
      },
    } as AnyDoc;
    const doc = await generateOpenApi(
      [
        route({
          method: 'POST',
          path: '/middleware-body',
          middlewares: [
            requestMiddleware(z.object({ traceId: z.string() })),
            requestMiddleware(opaque),
          ],
          entry: {
            handler: () => {},
            request: z.object({ name: z.string() }),
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    const schema = (doc as AnyDoc).paths['/middleware-body'].post.requestBody
      .content['application/json'].schema;
    assertMatchObject(schema.properties, {
      name: { type: 'string' },
      traceId: { type: 'string' },
    });
  });

  it('uses meta.description as the operation summary', async () => {
    const doc = await generateOpenApi(
      [
        route({
          method: 'GET',
          path: '/',
          entry: {
            handler: () => {},
            meta: {
              methodName: 'home',
              controllerClass: 'Home',
              description: 'The homepage',
            },
          },
        }),
      ],
      { info: { title: 't', version: '1' } },
    );

    assert.strictEqual((doc as AnyDoc).paths['/'].get.summary, 'The homepage');
  });
});
