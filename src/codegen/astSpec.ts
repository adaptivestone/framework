/**
 * Adapter: AST extraction → `ControllerSubtreeSpec` (plan:
 * `.plans/refactor/queued/codegen-ast.md`). Turns a controller's parsed source
 * (`astResolve`) into the same plain spec the runtime builds from an instance,
 * so codegen feeds the SHARED `buildSubtreeFromSpec` → `RouteRegistry.flatten()`
 * — the real resolver, no parallel matcher.
 *
 * The spec carries SYNTHETIC stand-ins: handlers are no-op functions whose
 * `.name` is the handler name, and each middleware is an opaque entry whose
 * `Class.name` is the import BINDING. The registry/flatten treat both opaquely
 * (route by scope, never call the class), and codegen reads only those names —
 * so the live classes the boot path needed (and the identity matching that came
 * with them) are gone. The emittable `binding → specifier` map comes from
 * `astResolve` (`resolved.imports`), never from a live class.
 */

import {
  buildSubtreeFromSpec,
  type ControllerSubtreeSpec,
  convertPathSyntax,
  parseScopeKey,
} from '../controllers/index.ts';
import type AbstractMiddleware from '../services/http/middleware/AbstractMiddleware.ts';
import type {
  HandlerEntry,
  HttpMethod,
  MiddlewareEntry,
  RouteNode,
} from '../services/http/routing/RouteNode.ts';
import type { StandardSchemaV1 } from '../services/validate/types.ts';
import { type ResolvedController, resolveController } from './astResolve.ts';

export interface AstSpec {
  spec: ControllerSubtreeSpec;
  /** The resolved data (routes + effective middleware + emittable imports). */
  resolved: ResolvedController;
}

/** A no-op function whose `.name` is `name` (codegen never calls it). */
function named(name: string): (...args: unknown[]) => void {
  return { [name]: () => {} }[name] as (...args: unknown[]) => void;
}

/** Synthetic middleware entry carrying the binding NAME as `Class.name`. */
function syntheticMiddleware(binding: string): MiddlewareEntry {
  return { Class: named(binding) as unknown as typeof AbstractMiddleware };
}

/** Build a `ControllerSubtreeSpec` from a controller's source (no instance). */
export async function specFromExtracted(srcPath: string): Promise<AstSpec> {
  const resolved = await resolveController(srcPath);

  const handlers: ControllerSubtreeSpec['handlers'] = resolved.routes.map(
    (r) => {
      const entry: HandlerEntry = {
        handler: named(r.handler ?? 'handler'),
        meta: { methodName: r.handler ?? undefined },
      };
      if (r.hasRequest) {
        entry.request = {} as StandardSchemaV1;
      }
      if (r.hasQuery) {
        entry.query = {} as StandardSchemaV1;
      }
      if (r.middleware?.length) {
        entry.middlewares = r.middleware.map(syntheticMiddleware);
      }
      return {
        method: r.method.toUpperCase() as HttpMethod,
        path: convertPathSyntax(r.path),
        entry,
      };
    },
  );

  const middleware: ControllerSubtreeSpec['middleware'] =
    resolved.middleware.map((scope) => {
      const parsed = parseScopeKey(scope.scope);
      return {
        method: parsed.method,
        path: convertPathSyntax(parsed.path),
        entries: scope.bindings.map(syntheticMiddleware),
      };
    });

  return {
    spec: { ctrlName: resolved.className ?? 'Unknown', handlers, middleware },
    resolved,
  };
}

/** Convenience: the assembled `RouteNode` subtree for a controller's source. */
export async function subtreeFromExtracted(srcPath: string): Promise<{
  subtree: RouteNode;
  resolved: ResolvedController;
}> {
  const { spec, resolved } = await specFromExtracted(srcPath);
  return { subtree: buildSubtreeFromSpec(spec), resolved };
}
