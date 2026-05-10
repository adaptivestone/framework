/**
 * Pure controller-shape extraction. Given an instantiated controller,
 * walks the `routes` getter and returns a structural manifest with
 * one entry per (method, path).
 *
 * Middleware chains are NOT computed here — that's the registry's job
 * (`RouteRegistry.flatten()`). Codegen pairs this metadata with the
 * registry output to render per-handler `<MethodName>Request` aliases.
 */

import type AbstractController from '../modules/AbstractController.ts';

/** One middleware reference, with its parameters if it was declared as a tuple. */
export interface MiddlewareRef {
  className: string;
  /** Present when the middleware was declared as `[Class, params]` in a Map or route-level array. */
  params?: Record<string, unknown>;
}

/** One route registered by a controller. */
export interface RouteMeta {
  method: string;
  path: string;
  /** Method name on the controller (e.g., `'postLogin'`). `null` if the route's handler couldn't be identified. */
  handlerName: string | null;
  /** True when the route entry is `{ handler, request }` and `request` is set. */
  hasSchema: boolean;
}

/** Aggregate metadata for one controller. */
export interface ControllerMeta {
  /** Class name (e.g., `'Auth'`). */
  className: string;
  /** Folder prefix from auto-loader (`''` for top-level, `'test'` for `controllers/test/Foo.ts`). */
  prefix: string;
  /** URL prefix the controller mounts at (e.g., `/auth`). */
  urlPrefix: string;
  routes: RouteMeta[];
}

/** Extract metadata from one already-instantiated controller. */
export function extractControllerMeta(
  controller: AbstractController,
): ControllerMeta {
  const className = controller.constructor.name;
  const prefix = controller.prefix;
  const urlPrefix = controller.getHttpPath();

  const routes: RouteMeta[] = [];
  for (const [verb, methodRoutes] of Object.entries(
    controller.routes as Record<string, Record<string, unknown>>,
  )) {
    for (const [path, entry] of Object.entries(methodRoutes)) {
      routes.push(extractRouteMeta(verb, path, entry));
    }
  }

  return { className, prefix, urlPrefix, routes };
}

function extractRouteMeta(
  verb: string,
  path: string,
  entry: unknown,
): RouteMeta {
  // Bare method ref: `'/logout': this.postLogout`
  if (typeof entry === 'function') {
    return {
      method: verb,
      path,
      handlerName: nameOf(entry),
      hasSchema: false,
    };
  }
  if (entry && typeof entry === 'object') {
    const obj = entry as { handler?: unknown; request?: unknown };
    return {
      method: verb,
      path,
      handlerName:
        typeof obj.handler === 'function' ? nameOf(obj.handler) : null,
      hasSchema: obj.request != null,
    };
  }
  return { method: verb, path, handlerName: null, hasSchema: false };
}

function nameOf(value: unknown): string | null {
  if (typeof value === 'function') {
    const fn = value as { name?: string };
    return fn.name && fn.name.length > 0 ? fn.name : null;
  }
  return null;
}
