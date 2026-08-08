/**
 * Integration test: drive a real controller through `ControllerManager` (the
 * same boot path the `openapi` command uses — minimal registry stand-in +
 * `skipWrap`), then generate the OpenAPI document from `flatten()`. Exercises
 * the full runtime path end to end: route + schema introspection, middleware
 * security, and the `description`/`controllerClass` meta threading.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { number, object, string } from 'yup';
import ControllerManager from '../../controllers/index.ts';
import AbstractController from '../../modules/AbstractController.ts';
import type { IApp } from '../../server.ts';
import {
  assertContainEqual,
  assertMatchObject,
  pattern,
} from '../../tests/assertions.ts';
import AbstractMiddleware from '../http/middleware/AbstractMiddleware.ts';
import { RouteRegistry } from '../http/routing/RouteRegistry.ts';
import { generateOpenApi } from './OpenApiGenerator.ts';

// biome-ignore lint/suspicious/noExplicitAny: stubs/assertions read loosely-typed shapes
type AnyDoc = any;

const fakeApp = (registry: RouteRegistry): IApp =>
  ({
    httpServer: { routeRegistry: registry },
    logger: { child: () => ({ warn() {}, verbose() {}, error() {} }) },
  }) as AnyDoc;

class TokenAuth extends AbstractMiddleware {
  static get usedAuthParameters() {
    return [
      {
        name: 'bearerAuth',
        type: 'http',
        scheme: 'bearer',
        description: 'auth',
      },
    ];
  }
  static get relatedRequestParameters() {
    return object({ token: string() }) as never;
  }
}

class Items extends AbstractController {
  get routes() {
    return {
      post: {
        '/': {
          handler: this.create,
          description: 'Create an item',
          request: object({ name: string().required(), note: string() }),
          middleware: [TokenAuth],
        },
      },
      get: {
        '/:id': {
          handler: this.getOne,
          query: object({ verbose: string() }),
        },
        // A declared `params:` schema must refine the emitted path parameter —
        // `number` here, versus the `string` fallback `/:id` above still gets.
        '/page/:page': {
          handler: this.getPage,
          params: object({ page: number().required() }),
        },
      },
    };
  }
  async create() {}
  async getOne() {}
  async getPage() {}
}

describe('generateOpenApi over a real ControllerManager registry', () => {
  it('documents bodies, query, path params, security and descriptions', async () => {
    const registry = new RouteRegistry();
    const cm = new ControllerManager(fakeApp(registry));
    cm.registerController(Items, '', { skipWrap: true });

    const doc = await generateOpenApi(registry.flatten(), {
      info: { title: 'Items API', version: '1.0.0' },
    });
    const paths = doc.paths as Record<string, AnyDoc>;

    // POST /items — body merges route schema (name, note) + middleware (token).
    const post = paths['/items'].post;
    assert.strictEqual(post.summary, 'Create an item');
    assert.strictEqual(post.operationId, 'Items_create');
    assert.deepStrictEqual(post.tags, ['Items']);
    const body = post.requestBody.content['application/json'].schema;
    assert.deepStrictEqual(Object.keys(body.properties).sort(), [
      'name',
      'note',
      'token',
    ]);
    assert.deepStrictEqual(body.required, ['name']);
    // bearerAuth comes from our route middleware; the controller's default
    // chain (GetUserByToken) may add more — assert presence, not exclusivity.
    assertContainEqual(post.security, { bearerAuth: [] });
    assertMatchObject((doc.components as AnyDoc).securitySchemes.bearerAuth, {
      type: 'http',
      scheme: 'bearer',
    });

    // GET /items/{id} — path param + query param.
    const get = paths['/items/{id}'].get;
    assertContainEqual(get.parameters, {
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    assertContainEqual(
      get.parameters,
      pattern.objectContaining({ name: 'verbose', in: 'query' }),
    );

    // GET /items/page/{page} — the params schema types what the URL pattern
    // alone could only call a string.
    assertContainEqual(paths['/items/page/{page}'].get.parameters, {
      name: 'page',
      in: 'path',
      required: true,
      schema: { type: 'number' },
    });
  });
});
