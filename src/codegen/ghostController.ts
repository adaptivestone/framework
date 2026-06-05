/**
 * Codegen-only controller introspection. Reads a controller's `routes` /
 * `getHttpPath()` WITHOUT running its constructor, so type generation never
 * triggers constructor side effects (config reads, S3/OAuth client construction,
 * timers).
 *
 * Lives in the codegen layer on purpose: the controllers/runtime layer must not
 * depend on this. Codegen builds the ghost here and hands it to the existing
 * `ControllerManager.registerControllerInstance` — so route/middleware tree
 * semantics stay defined exactly once (in `#buildSubtree`), with no parallel
 * reader to drift.
 */

import { makeOncePerClassWarner } from '../helpers/deprecation.ts';
import type AbstractController from '../modules/AbstractController.ts';
import type { IApp } from '../server.ts';

// Fires once per class when a controller's `routes` getter depends on
// constructor-set state, so the ghost read throws and we fall back to a real
// instance. Shares the neutral once-per-class warner with the runtime
// middleware-schema deprecation.
const warnCtorDependentRoutes = makeOncePerClassWarner(
  'ASF_DEP_CTOR_ROUTES',
  (name, err) =>
    `Controller "${name}" reads constructor-set state in its \`routes\` getter, so codegen had to instantiate it (${(err as Error)?.message ?? 'ghost read failed'}). This forces constructor side effects during type generation. Make \`routes\` independent of constructor state — the instance fallback will be removed in v6.`,
);

/**
 * Build a constructor-less "ghost" of a controller for codegen to read.
 *
 * `Object.create(Class.prototype)` skips the constructor; `app` and `prefix` are
 * the only base-constructor fields a well-behaved `routes` / `getHttpPath` read,
 * so they're defined on the ghost. The read is pre-validated (touch `routes` +
 * `getHttpPath`) so a controller whose `routes` depends on constructor state
 * (private-field read, or deref of undefined state) is caught here and falls
 * back to a real instance — warned once per class — before any registration.
 *
 * Known residual (accepted for v5, closed by the v6 ghost-only cutover): a
 * `routes` getter that reads a constructor-set *scalar* without dereferencing it
 * yields `undefined` rather than throwing, so the fallback can't detect it.
 */
export function ghostController<T extends typeof AbstractController>(
  ControllerClass: T,
  app: IApp,
  prefix: string,
): InstanceType<T> {
  const ghost = Object.create(ControllerClass.prototype) as InstanceType<T>;
  const fields = ghost as unknown as { app: IApp; prefix: string };
  fields.app = app;
  fields.prefix = prefix;
  try {
    // Touch exactly what registration + metadata extraction read.
    void (ghost as unknown as { routes: unknown }).routes;
    ghost.getHttpPath();
    return ghost;
  } catch (err) {
    warnCtorDependentRoutes(ControllerClass, err);
    return new ControllerClass(app, prefix) as InstanceType<T>;
  }
}
