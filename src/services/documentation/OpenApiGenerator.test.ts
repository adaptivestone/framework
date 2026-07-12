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
