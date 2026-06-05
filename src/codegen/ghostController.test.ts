import { describe, expect, it, vi } from 'vitest';
import ControllerManager from '../controllers/index.ts';
import AbstractController from '../modules/AbstractController.ts';
import type { IApp } from '../server.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import { ghostController } from './ghostController.ts';

/**
 * P1j Phase 2 — codegen reads controllers via a constructor-less ghost, falling
 * back to a real instance (with a one-per-class DeprecationWarning) only when a
 * `routes` getter depends on constructor-set state. The ghost is then fed to the
 * existing `registerControllerInstance` (same tree-builder as runtime).
 */

const makeLogger = () => {
  const l: Record<string, unknown> = {};
  for (const m of ['error', 'warn', 'info', 'verbose', 'debug', 'silly']) {
    l[m] = () => {};
  }
  l.child = () => l;
  return l;
};

const makeApp = (registry: RouteRegistry): IApp =>
  ({
    logger: makeLogger(),
    httpServer: { routeRegistry: registry },
    foldersConfig: { controllers: '' },
  }) as unknown as IApp;

let ghostSafeCtor = 0;
class GhostSafeController extends AbstractController {
  constructor(app: IApp, prefix: string) {
    super(app, prefix);
    ghostSafeCtor++;
  }
  get routes() {
    return { get: { '/ping': { handler: this.ping } } };
  }
  async ping() {}
}

let ctorDependentCtor = 0;
class CtorDependentController extends AbstractController {
  #models: string[] = [];
  constructor(app: IApp, prefix: string) {
    super(app, prefix);
    ctorDependentCtor++;
    this.#models = ['alpha'];
  }
  get routes() {
    // reads constructor-set PRIVATE state → throws on a ghost → triggers fallback
    const first = this.#models[0];
    return { get: { [`/${first}`]: { handler: this.list } } };
  }
  async list() {}
}

describe('ghostController — codegen read with fallback', () => {
  it('reads a ghost-safe controller WITHOUT running its constructor', () => {
    const before = ghostSafeCtor;
    const ghost = ghostController(
      GhostSafeController,
      makeApp(new RouteRegistry()),
      'test',
    );
    expect(ghostSafeCtor).toBe(before); // constructor never fired
    expect(ghost.getHttpPath()).toBe('/test/ghostsafecontroller');
    expect(
      Object.keys((ghost as unknown as { routes: { get: object } }).routes.get),
    ).toContain('/ping');
  });

  it('falls back to a real instance + warns when routes need constructor state', () => {
    const emitWarning = vi
      .spyOn(process, 'emitWarning')
      .mockImplementation(() => {});
    const before = ctorDependentCtor;
    const inst = ghostController(
      CtorDependentController,
      makeApp(new RouteRegistry()),
      '',
    );
    expect(ctorDependentCtor).toBe(before + 1); // fallback ran the constructor once
    expect(emitWarning).toHaveBeenCalledWith(
      expect.stringContaining('CtorDependentController'),
      expect.objectContaining({ code: 'ASF_DEP_CTOR_ROUTES' }),
    );
    expect(
      (inst as unknown as { routes: { get: Record<string, unknown> } }).routes
        .get['/alpha'],
    ).toBeDefined();
    emitWarning.mockRestore();
  });

  it('registerControllerInstance registers a ghost into the registry', () => {
    const registry = new RouteRegistry();
    const cm = new ControllerManager(makeApp(registry));
    const ghost = ghostController(GhostSafeController, cm.app, '');

    cm.registerControllerInstance(ghost, '', { skipWrap: true });

    expect(cm.controllers.ghostsafecontroller).toBe(ghost);
    expect(
      registry.flatten().some((f) => f.path === '/ghostsafecontroller/ping'),
    ).toBe(true);
  });

  it('runtime registerController constructs a real instance', () => {
    const cm = new ControllerManager(makeApp(new RouteRegistry()));
    const before = ghostSafeCtor;

    cm.registerController(GhostSafeController, '', { skipWrap: true });

    expect(ghostSafeCtor).toBe(before + 1); // real `new`
  });
});
