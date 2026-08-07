/**
 * Renderer test for `formatRouteTree` — drives a real controller through
 * `ControllerManager` (the same boot path the `routes` command uses: minimal
 * registry stand-in + `skipWrap`), then asserts the rendered tree. ANSI colours
 * are stripped before matching.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ControllerManager from '../../../controllers/index.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { IApp } from '../../../server.ts';
import { assertTextMatch } from '../../../tests/assertions.ts';
import AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import { formatRouteTree } from './formatTree.ts';
import { RouteRegistry } from './RouteRegistry.ts';

// biome-ignore lint/suspicious/noExplicitAny: test stub reads a loosely-typed shape
type AnyApp = any;

const fakeApp = (registry: RouteRegistry): IApp =>
  ({
    httpServer: { routeRegistry: registry },
    logger: { child: () => ({ warn() {}, verbose() {}, error() {} }) },
  }) as AnyApp;

class Guard extends AbstractMiddleware {}

class Widgets extends AbstractController {
  get routes() {
    return {
      get: {
        '/': { handler: this.list },
        '/:id': { handler: this.getOne },
      },
      post: {
        '/': { handler: this.create, middleware: [Guard] },
      },
    };
  }
  async list() {}
  async getOne() {}
  async create() {}
}

// Build the strip pattern without a literal control char (biome-friendly).
const ESC = String.fromCharCode(27);
const stripAnsi = (s: string): string =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

describe('formatRouteTree', () => {
  it('renders the registry as a tree with methods, params, middleware and a summary', () => {
    const registry = new RouteRegistry();
    const cm = new ControllerManager(fakeApp(registry));
    cm.registerController(Widgets, '', { skipWrap: true });

    const out = stripAnsi(formatRouteTree(registry));

    assert.ok(out.includes('Registered routes:'));
    assert.ok(out.includes('widgets'));
    assertTextMatch(out, /GET\s+\/widgets\b/);
    assertTextMatch(out, /GET\s+\/widgets\/:id\b/);
    assertTextMatch(out, /POST\s+\/widgets\b/);
    assert.ok(out.includes(':id')); // param segment rendered verbatim
    assert.ok(out.includes('mw: Guard')); // route-level middleware surfaces
    assertTextMatch(out, /3 route\(s\) across \d+ node\(s\)/);
  });
});
