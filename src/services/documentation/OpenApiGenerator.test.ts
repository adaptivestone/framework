import { describe, expect, it, vi } from 'vitest';
import { object, string } from 'yup';
import { z } from 'zod';
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

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toEqual({ title: 'My API', version: '1.2.3' });
    expect(doc.servers).toEqual([
      { url: 'http://localhost:3300', description: 'Localhost' },
    ]);
    expect(doc.paths).toEqual({});
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
    expect(op.operationId).toBe('Items_getItem');
    expect(op.tags).toEqual(['Items']);
    expect(op.parameters).toContainEqual({
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
    expect(schema.type).toBe('object');
    expect(schema.properties.name).toEqual({ type: 'string' });
    expect(schema.required).toEqual(['name']);
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
    expect(Object.keys(content).sort()).toEqual([
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
    expect(page).toMatchObject({ in: 'query', required: true });
    expect(q).toMatchObject({ in: 'query', required: false });
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
    expect(limits).toHaveLength(1);
    // The survivor is the route's own schema (number), not the middleware's.
    expect(limits[0].schema).toEqual({ type: 'number' });
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
    expect(limits).toHaveLength(1);
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

    expect((doc as AnyDoc).components.securitySchemes.Authorization).toEqual({
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
      description: 'token auth',
    });
    expect((doc as AnyDoc).paths['/me'].get.security).toEqual([
      { Authorization: [] },
    ]);
  });

  it('degrades to a placeholder + warning for an un-introspectable schema', async () => {
    const onWarning = vi.fn();
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
    expect(schema.type).toBe('object');
    expect(schema.description).toMatch(/introspection unavailable/i);
    expect(onWarning).toHaveBeenCalled();
  });

  it('contains a throwing schema exporter to its route and keeps exporting', async () => {
    const onWarning = vi.fn();
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

    expect(
      (doc as AnyDoc).paths['/broken'].post.requestBody.content[
        'application/json'
      ].schema,
    ).toMatchObject({
      type: 'object',
      description: expect.stringMatching(/introspection unavailable/i),
    });
    expect(
      (doc as AnyDoc).paths['/healthy'].post.requestBody.content[
        'application/json'
      ].schema.properties.name,
    ).toEqual({ type: 'string' });
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringMatching(
        /POST \/broken body: schema conversion failed.*deliberately unrepresentable/i,
      ),
    );
  });

  it('approximates a splat as a path parameter and warns', async () => {
    const onWarning = vi.fn();
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

    expect((doc as AnyDoc).paths['/files/{rest}'].get).toBeDefined();
    expect(onWarning).toHaveBeenCalledWith(expect.stringMatching(/catch-all/i));
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

    expect((doc as AnyDoc).paths['/items'].get.operationId).toBe(
      'Items_getList',
    );
    expect((doc as AnyDoc).paths['/users'].get.operationId).toBe(
      'Users_getList',
    );
    expect(operationIds(doc)).toHaveLength(new Set(operationIds(doc)).size);
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
    expect(ids).toHaveLength(new Set(ids).size); // all unique

    // Deterministic across runs.
    const again = operationIds(await generateOpenApi(routes, opts));
    expect(again).toEqual(ids);
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

    expect(
      operationIds(
        await generateOpenApi(routes, {
          info: { title: 't', version: '1' },
        }),
      ),
    ).toEqual([
      'Reports_list',
      'Reports_list_get',
      'Reports_list_get_2',
      'Reports_list_get_3',
    ]);
  });

  it('derives operationIds from the method and path when handler metadata is absent', async () => {
    const doc = await generateOpenApi(
      [
        route({ method: 'GET', path: '/' }),
        route({ method: 'POST', path: '/files/:id' }),
      ],
      { info: { title: 't', version: '1' } },
    );

    expect(operationIds(doc)).toEqual(['get_root', 'post_files_id']);
  });

  it('warns and uses safe fallbacks for opaque query and content-map schemas', async () => {
    const onWarning = vi.fn();
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
    expect(operation.parameters).toBeUndefined();
    expect(
      operation.requestBody.content['application/custom'].schema,
    ).toMatchObject({
      type: 'object',
      description: expect.stringMatching(/introspection unavailable/i),
    });
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('query'));
    expect(onWarning).toHaveBeenCalledWith(
      expect.stringContaining('application/custom'),
    );
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

    expect((doc as AnyDoc).components.securitySchemes.PartnerOAuth).toEqual({
      type: 'oauth2',
      description: 'Partner authorization',
    });
    expect((doc as AnyDoc).components.securitySchemes.BearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      description: 'Bearer authorization',
    });
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
    expect(schema.properties).toMatchObject({
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

    expect((doc as AnyDoc).paths['/'].get.summary).toBe('The homepage');
  });
});
