/**
 * Shared codegen metadata types. The AST front-end (`astExtract`/`astResolve`/
 * `astEmit`) produces these; `emit` renders from them. (Middleware chains are
 * computed by `RouteRegistry.flatten()`, not here.)
 */

/** One middleware reference in a route's chain, by its local import binding. */
export interface MiddlewareRef {
  /** The local import binding the gen file emits (`typeof <className>`). */
  className: string;
  /** Present when declared as `[Class, params]` in a Map / route-level array. */
  params?: Record<string, unknown>;
}

/**
 * How a middleware binding was imported, so the gen file emits the matching
 * `import type` form: `default` → `import type X`, `named` → `import type { X }`
 * (or `{ Orig as X }` when renamed), `namespace` → `import type * as X`.
 */
export interface MiddlewareImport {
  /** Module specifier to import the binding from. */
  specifier: string;
  kind: 'default' | 'named' | 'namespace';
  /** Original export name when the local binding renames it (`{ Orig as X }`). */
  orig?: string;
}

/** One route registered by a controller. */
export interface RouteMeta {
  method: string;
  path: string;
  /** Method name on the controller (e.g. `'postLogin'`); `null` if unidentifiable. */
  handlerName: string | null;
  /** True when the route entry has a `request` schema. */
  hasSchema: boolean;
  /**
   * Media-type keys when `request` is a content-type map (`{ 'application/json':
   * schema, … }`). Drives the discriminated-union request type. Absent for a
   * single-schema `request`.
   */
  requestContentTypes?: string[];
  /** True when the route entry has a `query` schema. */
  hasQuerySchema: boolean;
}

/** Aggregate metadata for one controller. */
export interface ControllerMeta {
  /** Class name (e.g. `'Auth'`). */
  className: string;
  /** Folder prefix from the auto-loader (`''` for top-level). */
  prefix: string;
  /** URL prefix the controller mounts at (e.g. `/auth`). */
  urlPrefix: string;
  routes: RouteMeta[];
}
