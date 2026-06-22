/**
 * Renderer test for `formatRouteTree` — drives a real controller through
 * `ControllerManager` (the same boot path the `routes` command uses: minimal
 * registry stand-in + `skipWrap`), then asserts the rendered tree. ANSI colours
 * are stripped before matching.
 */
import { describe, expect, it } from 'vitest';
import ControllerManager from '../../../controllers/index.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { IApp } from '../../../server.ts';
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

    expect(out).toContain('Registered routes:');
    expect(out).toContain('widgets');
    expect(out).toMatch(/GET\s+\/widgets\b/);
    expect(out).toMatch(/GET\s+\/widgets\/:id\b/);
    expect(out).toMatch(/POST\s+\/widgets\b/);
    expect(out).toContain(':id'); // param segment rendered verbatim
    expect(out).toContain('mw: Guard'); // route-level middleware surfaces
    expect(out).toMatch(/3 route\(s\) across \d+ node\(s\)/);
  });
});
