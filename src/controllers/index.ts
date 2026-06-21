import path from 'node:path';
import * as url from 'node:url';
import type { NextFunction, Response } from 'express';
import { makeOncePerClassWarner } from '../helpers/deprecation.ts';
import type AbstractController from '../modules/AbstractController.ts';
import Base from '../modules/Base.ts';
import type { IApp } from '../server.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import AbstractMiddleware from '../services/http/middleware/AbstractMiddleware.ts';
import {
  type MiddlewareSpec,
  normalizeMiddlewares,
} from '../services/http/routing/middlewareNormalization.ts';
import type {
  HandlerEntry,
  HttpMethod,
  MiddlewareEntry,
  RouteNode,
} from '../services/http/routing/RouteNode.ts';
import { HTTP_METHODS } from '../services/http/routing/RouteNode.ts';
import { createNode } from '../services/http/routing/RouteRegistry.ts';
import {
  isContentTypeRequestMap,
  normalizeContentType,
} from '../services/validate/contentType.ts';
import type { StandardSchemaV1 } from '../services/validate/types.ts';
import ValidateService from '../services/validate/ValidateService.ts';

/** HTTP methods valid in a controller's `routes` getter (no `'ALL'`). */
const ROUTE_HTTP_METHODS: ReadonlySet<string> = new Set(HTTP_METHODS);

/** HTTP methods plus the `'ALL'` pseudo-verb for middleware-Map scope keys. */
const MAP_KEY_METHODS: ReadonlySet<string> = new Set([...HTTP_METHODS, 'ALL']);

// Middleware schema reading (P1j Phase 1): prefer the static getters; the
// instance form is deprecated. A middleware is only instantiated when it
// actually overrides the deprecated instance getter — warned once per class
// (shared neutral warner factory; see `helpers/deprecation.ts`). This is a
// RUNTIME concern, read in `#wrapHandlerEntry` at server boot.
const warnInstanceSchemaDeprecated = makeOncePerClassWarner(
  'ASF_DEP_MW_INSTANCE_SCHEMA',
  (name) =>
    `Middleware "${name}" declares request/query schemas via the deprecated instance getter (relatedRequestParameters / relatedQueryParameters). Switch to the static form (static get relatedRequestParameters() { ... }) — the instance form forces instantiation and will be removed in v6.`,
);

/**
 * Does a middleware class override the deprecated instance schema getters? Walks
 * its prototype chain (excluding `AbstractMiddleware`'s own defaults) without
 * instantiating, so middlewares with no instance schema are never constructed.
 */
function overridesInstanceSchema(Class: MiddlewareEntry['Class']): boolean {
  let proto: object | null = Class.prototype;
  while (proto && proto !== AbstractMiddleware.prototype) {
    if (
      Object.getOwnPropertyDescriptor(proto, 'relatedRequestParameters') ||
      Object.getOwnPropertyDescriptor(proto, 'relatedQueryParameters')
    ) {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

/**
 * Class does autoloading a http controllers
 */
class ControllerManager extends Base {
  controllers: Record<string, AbstractController>;
  constructor(app: IApp) {
    super(app);
    this.controllers = {};
  }

  /**
   * Register a controller explicitly. Returns the constructed instance.
   * Builds a `RouteNode` subtree from the controller's `routes` getter and
   * `static middleware` Map, wraps handlers with validation, and registers
   * with the `RouteRegistry`. For late registration (after `startServer`
   * finishes) use `Server.startServer`'s `callbackBefore404` hook.
   */
  registerController<T extends typeof AbstractController>(
    ControllerClass: T,
    prefix = '',
    options: { skipWrap?: boolean } = {},
  ): InstanceType<T> {
    const instance = new ControllerClass(this.app, prefix) as InstanceType<T>;
    return this.registerControllerInstance(instance, prefix, options);
  }

  /**
   * Register an already-constructed controller instance: store it, build its
   * `RouteNode` subtree (from `routes` + the static middleware Map), optionally
   * wrap handlers with validation, and register with the `RouteRegistry`.
   *
   * Reads the instance into a `ControllerSubtreeSpec` (`#specFromInstance`) and
   * assembles the tree via the shared `buildSubtreeFromSpec`. Codegen reaches the
   * same assembler directly from parsed source (no instance) — see
   * `codegen/astSpec.ts` — so tree/middleware semantics live in one place.
   */
  registerControllerInstance<T extends AbstractController>(
    instance: T,
    prefix = '',
    options: { skipWrap?: boolean } = {},
  ): T {
    const name = instance.constructor.name.toLowerCase();
    const key = prefix ? `${prefix}/${name}` : name;
    this.controllers[key] = instance;

    const registry = this.app.httpServer?.routeRegistry;
    if (!registry) {
      this.logger?.warn(
        `RouteRegistry not available; controller ${key} not registered with the new routing.`,
      );
      return instance;
    }

    const subtree = this.#buildSubtree(instance);
    // `skipWrap` is the codegen escape hatch — we only need the tree
    // structure to emit types, not the runtime validation wrappers.
    // Wrapping instantiates every middleware in every handler's chain
    // to read schemas, which side-effects (Redis clients, timers, etc.)
    // and keeps the event loop open for codegen-only runs.
    if (!options.skipWrap) {
      this.#wrapHandlersInSubtree(subtree, []);
    }
    registry.registerSubtree(instance.getHttpPath(), subtree);
    return instance;
  }

  /**
   * Discover and import every controller module — framework-internal plus the
   * user's folder, with user overrides winning on filename collision (handled by
   * `getFilesPathWithInheritance`). Returns each class with its folder prefix.
   *
   * The shared "load" step that does not instantiate — runtime boot
   * (`initControllers`) and codegen both drive the per-class loop from this.
   * Imports run in parallel; the returned order is the index-first sort, so
   * registration is deterministic.
   */
  async loadControllerClasses(): Promise<
    { ControllerClass: typeof AbstractController; prefix: string }[]
  > {
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const controllersToLoad = await this.getFilesPathWithInheritance(
      dirname,
      this.app.foldersConfig.controllers,
    );

    // Index files first so root-level routes/middleware land before nested ones.
    controllersToLoad.sort((a, b) => {
      if (
        a.file.toLowerCase().endsWith('index.js') ||
        a.file.toLowerCase().endsWith('index.ts')
      ) {
        if (
          b.file.toLowerCase().endsWith('index.js') ||
          b.file.toLowerCase().endsWith('index.ts')
        ) {
          return 0;
        }
        return -1;
      }
      return 0;
    });

    return Promise.all(
      controllersToLoad.map(async ({ path: modulePath, file }) => {
        const { default: ControllerClass } = await import(modulePath);
        const dir = path.dirname(file);
        return { ControllerClass, prefix: dir === '.' ? '' : dir };
      }),
    );
  }

  /**
   * Auto-load controllers (see `loadControllerClasses`) and register each one
   * with a real instance.
   *
   * `options.skipWrap` (codegen-only): build the registry tree without wrapping
   * handlers with validation — skips middleware instantiation, which avoids side
   * effects (Redis clients, timers) in introspection commands like
   * `generatetypes`.
   */
  async initControllers(options: { skipWrap?: boolean } = {}) {
    const classes = await this.loadControllerClasses();
    for (const { ControllerClass, prefix } of classes) {
      this.registerController(ControllerClass, prefix, options);
    }
  }

  /**
   * Build a `RouteNode` subtree for one controller. Two steps, decoupled so the
   * codegen AST path can feed the SAME assembler without an instance: read the
   * instance into a plain `ControllerSubtreeSpec` (`#specFromInstance`), then
   * assemble the tree from that spec (`buildSubtreeFromSpec`). Tree/scope
   * semantics live entirely in the assembler — there is no parallel builder.
   */
  #buildSubtree(controller: AbstractController): RouteNode {
    return buildSubtreeFromSpec(this.#specFromInstance(controller));
  }

  /**
   * Read a controller instance into a plain `ControllerSubtreeSpec`: walk the
   * `routes` getter into placed `HandlerEntry`s (handlers bound to the instance)
   * and the `static middleware` Map into normalized, scope-parsed entries. Path
   * syntax is converted here (`{*splat}` → `*splat`); the assembler attaches
   * verbatim. All authoring-time warnings (unknown verb, missing handler,
   * unknown method prefix) live here — the instance is the only thing that can
   * be malformed.
   */
  #specFromInstance(controller: AbstractController): ControllerSubtreeSpec {
    const ctrlName = controller.constructor.name;
    const handlers: ControllerSubtreeSpec['handlers'] = [];
    const middleware: ControllerSubtreeSpec['middleware'] = [];

    // 1. Routes first — handlers placed in the tree before middleware
    //    attachments look for them.
    const routes = (controller as unknown as { routes: unknown }).routes;
    if (routes && typeof routes === 'object') {
      for (const [verb, routeMap] of Object.entries(
        routes as Record<string, Record<string, unknown>>,
      )) {
        if (!routeMap || typeof routeMap !== 'object') {
          continue;
        }
        const upperVerb = verb.toUpperCase();
        if (!ROUTE_HTTP_METHODS.has(upperVerb)) {
          this.logger?.warn(
            `Controller ${ctrlName}: unknown verb '${verb}' in routes getter (expected one of: ${[...ROUTE_HTTP_METHODS].join(', ').toLowerCase()}). Routes under this verb will never match.`,
          );
          continue;
        }
        for (const [pathKey, routeSpec] of Object.entries(routeMap)) {
          const entry = buildHandlerEntry(routeSpec, controller);
          if (!entry) {
            // Object spec but no callable `handler` field — a common
            // misconfiguration (e.g., `{ request: schema }` without a
            // handler). Warn and skip; the old framework also rejected
            // these with a 500 at request time.
            if (
              routeSpec !== null &&
              typeof routeSpec === 'object' &&
              typeof (routeSpec as { handler?: unknown }).handler !== 'function'
            ) {
              this.logger?.warn(
                `Controller ${ctrlName}: route ${upperVerb} ${pathKey} has no \`handler\` function. Skipping.`,
              );
            }
            continue;
          }
          // Tag the controller so the OpenAPI generator can derive tags +
          // operationIds without re-deriving them from the path.
          if (entry.meta) {
            entry.meta.controllerClass ??= ctrlName;
          }
          handlers.push({
            method: upperVerb as HttpMethod,
            path: convertPathSyntax(pathKey),
            entry,
          });
        }
      }
    }

    // 2. Middleware Map — normalize + scope-parse.
    // `static get middleware()` lives on the class; instance.constructor
    // types as `Function`, so cast to read the static member.
    const ControllerClass = controller.constructor as unknown as {
      middleware?: Map<string, ReadonlyArray<MiddlewareSpec>>;
    };
    const mwMap = ControllerClass.middleware;
    if (mwMap instanceof Map) {
      for (const [scopeKey, mwList] of mwMap) {
        if (typeof scopeKey !== 'string') {
          this.logger?.warn(
            `Controller ${ctrlName}: middleware Map key is not a string (got ${typeof scopeKey}). Skipping.`,
          );
          continue;
        }
        if (!Array.isArray(mwList) || mwList.length === 0) {
          continue;
        }
        const parsed = parseScopeKey(scopeKey);
        if (parsed.unknownMethod) {
          this.logger?.warn(
            `Controller ${ctrlName}: middleware Map key '${scopeKey}' has unknown method prefix '${parsed.unknownMethod}'. Treating the whole key as a path. Expected method prefix is one of: ${[...MAP_KEY_METHODS].join(', ')}.`,
          );
        }
        middleware.push({
          method: parsed.method,
          path: convertPathSyntax(parsed.path),
          entries: normalizeMiddlewares(mwList),
        });
      }
    }

    return { ctrlName, handlers, middleware };
  }

  /**
   * Walk the subtree depth-first, accumulating middleware as we descend.
   * For each handler, wrap with validation that merges route schemas +
   * schemas declared by middlewares in the chain (`relatedRequestParameters`
   * / `relatedQueryParameters`).
   */
  #wrapHandlersInSubtree(
    node: RouteNode,
    accumulated: MiddlewareEntry[],
  ): void {
    const chain = [...accumulated, ...node.middlewares];
    if (node.methods) {
      for (const method of Object.keys(node.methods)) {
        const entry = node.methods[method as keyof typeof node.methods];
        if (entry) {
          const fullChain = [...chain, ...(entry.middlewares ?? [])];
          this.#wrapHandlerEntry(entry, fullChain);
        }
      }
    }
    for (const child of node.children.values()) {
      this.#wrapHandlersInSubtree(child, chain);
    }
    if (node.paramChild) {
      this.#wrapHandlersInSubtree(node.paramChild, chain);
    }
    if (node.splatChild) {
      this.#wrapHandlersInSubtree(node.splatChild, chain);
    }
  }

  #wrapHandlerEntry(entry: HandlerEntry, chain: MiddlewareEntry[]): void {
    const original = entry.handler;
    const app = this.app;
    const logger = this.logger;

    // Collect middleware-declared schemas at translation time. Static-first (no
    // instantiation); the instance form is deprecated and only read — via
    // instantiation — when a middleware actually overrides it.
    const middlewareRequestSchemas: StandardSchemaV1[] = [];
    const middlewareQuerySchemas: StandardSchemaV1[] = [];
    for (const mw of chain) {
      let r = mw.Class.relatedRequestParameters;
      let q = mw.Class.relatedQueryParameters;
      if (!r && !q && overridesInstanceSchema(mw.Class)) {
        warnInstanceSchemaDeprecated(mw.Class);
        const inst = new mw.Class(app, mw.params ?? {});
        r = inst.relatedRequestParameters;
        q = inst.relatedQueryParameters;
      }
      if (r) {
        middlewareRequestSchemas.push(r);
      }
      if (q) {
        middlewareQuerySchemas.push(q);
      }
    }

    // Route-entry request schema: a single Standard Schema, or a content-type
    // map resolved per-request by `Content-Type`. The map is resolved inside
    // the request handler (it depends on the incoming header); middleware
    // schemas are content-type-agnostic and resolved once here.
    //
    // The lookup table is a null-prototype object with lower-cased keys: this
    // makes matching case-insensitive AND prevents a header like `__proto__`
    // or `constructor` from resolving to an inherited `Object.prototype`
    // member (which would otherwise be truthy and bypass the 415).
    const entryRequest = entry.request as
      | StandardSchemaV1
      | Record<string, StandardSchemaV1>
      | undefined;
    let entryRequestMapLookup: Record<string, StandardSchemaV1> | null = null;
    let entryRequestMapKeys: string[] = [];
    if (isContentTypeRequestMap(entryRequest)) {
      entryRequestMapLookup = Object.create(null) as Record<
        string,
        StandardSchemaV1
      >;
      entryRequestMapKeys = Object.keys(entryRequest);
      for (const key of entryRequestMapKeys) {
        entryRequestMapLookup[key.toLowerCase()] = entryRequest[key];
      }
    }

    const querySchemas: StandardSchemaV1[] = [];
    if (entry.query) {
      querySchemas.push(entry.query);
    }
    querySchemas.push(...middlewareQuerySchemas);

    const wrapped = async (
      req: FrameworkRequest,
      res: Response,
      next: NextFunction,
    ): Promise<unknown> => {
      try {
        const requestSchemas: StandardSchemaV1[] = [];
        let resolvedContentType: string | null = null;
        if (entryRequestMapLookup) {
          const contentType = normalizeContentType(req.headers['content-type']);
          const matched =
            contentType && Object.hasOwn(entryRequestMapLookup, contentType)
              ? entryRequestMapLookup[contentType]
              : undefined;
          if (!matched) {
            return res.status(415).json({
              message: `Unsupported Content-Type. Expected one of: ${entryRequestMapKeys.join(
                ', ',
              )}`,
            });
          }
          requestSchemas.push(matched);
          resolvedContentType = contentType;
        } else if (entryRequest) {
          requestSchemas.push(entryRequest as StandardSchemaV1);
        }
        requestSchemas.push(...middlewareRequestSchemas);

        if (requestSchemas.length > 0) {
          const parts = await Promise.all(
            requestSchemas.map(
              (s) =>
                new ValidateService(app, s).validate(
                  req.body,
                  req.appInfo.i18n,
                ) as Promise<Record<string, unknown>>,
            ),
          );
          req.appInfo.request = Object.assign({}, ...parts);
          if (resolvedContentType) {
            (req.appInfo.request as Record<string, unknown>).contentType =
              resolvedContentType;
          }
        }
        if (querySchemas.length > 0) {
          const parts = await Promise.all(
            querySchemas.map(
              (s) =>
                new ValidateService(app, s).validate(
                  req.query,
                  req.appInfo.i18n,
                ) as Promise<Record<string, unknown>>,
            ),
          );
          req.appInfo.query = Object.assign({}, ...parts);
        }
      } catch (err) {
        if (res.headersSent) {
          return next(err);
        }
        return res.status(400).json({
          errors: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        return await Promise.resolve(original(req, res, next));
      } catch (err) {
        logger?.error(err);
        // A handler that already streamed can't be sent a 500 — hand off to the
        // error finalizer instead of crashing with ERR_HTTP_HEADERS_SENT.
        if (res.headersSent) {
          return next(err);
        }
        return res.status(500).json({
          message: 'Platform error. Please check later or contact support',
        });
      }
    };

    entry.handler = wrapped;
  }

  static get loggerGroup() {
    return 'controller';
  }
}

// ─── subtree assembly (shared boundary) ──────────────────────────────

/**
 * The plain, instance-free description of a controller's subtree: handlers to
 * place and middleware scopes to attach, both already path-converted and
 * (for middleware) normalized. The runtime builds this from a controller
 * instance (`#specFromInstance`); the codegen AST front-end builds the same
 * shape from parsed source — so both feed one assembler with zero drift.
 *
 * Paths are INTERNAL syntax (`*splat`, not `{*splat}`); `method` is upper-case
 * (`'ALL'` for path-only middleware scopes).
 */
export interface ControllerSubtreeSpec {
  ctrlName: string;
  handlers: { method: HttpMethod; path: string; entry: HandlerEntry }[];
  middleware: {
    method: HttpMethod | 'ALL';
    path: string;
    entries: MiddlewareEntry[];
  }[];
}

/**
 * Assemble a `RouteNode` subtree from a `ControllerSubtreeSpec`: place every
 * handler, then attach every middleware scope (handlers first, so middleware
 * attachments find them). This is the single home of tree/scope semantics —
 * runtime and codegen both reach it through here.
 */
export function buildSubtreeFromSpec(spec: ControllerSubtreeSpec): RouteNode {
  const subtree = createNode('');
  for (const h of spec.handlers) {
    attachHandler(subtree, h.method, h.path, h.entry);
  }
  for (const m of spec.middleware) {
    attachMiddlewares(subtree, m.method, m.path, m.entries);
  }
  return subtree;
}

// ─── translation helpers (file-local) ────────────────────────────────

/**
 * `'POST/login'` → method=POST,path=/login · `'/login'` → method=ALL,path=/login
 *
 * When the key looks like `METHOD/path` but the method isn't recognized
 * (likely a typo, e.g., `'PATC/login'`), returns `unknownMethod` so the
 * caller can warn instead of silently treating the whole key as a path.
 */
export function parseScopeKey(key: string): {
  method: HttpMethod | 'ALL';
  path: string;
  unknownMethod?: string;
} {
  if (key.startsWith('/')) {
    return { method: 'ALL', path: key };
  }
  const slashIdx = key.indexOf('/');
  if (slashIdx === -1) {
    return { method: 'ALL', path: `/${key}` };
  }
  const candidate = key.slice(0, slashIdx).toUpperCase();
  if (MAP_KEY_METHODS.has(candidate)) {
    return {
      method: candidate as HttpMethod | 'ALL',
      path: key.slice(slashIdx),
    };
  }
  return { method: 'ALL', path: `/${key}`, unknownMethod: candidate };
}

/** `{*splat}` → `*splat`. Other syntax stays as-is. */
export function convertPathSyntax(p: string): string {
  return p.replace(/\{\*([a-zA-Z_][a-zA-Z0-9_]*)\}/g, '*$1');
}

function buildHandlerEntry(
  spec: unknown,
  controller: object,
): HandlerEntry | null {
  if (typeof spec === 'function') {
    return {
      handler: spec.bind(controller),
      meta: { methodName: spec.name || undefined },
    };
  }
  if (typeof spec !== 'object' || spec === null) {
    return null;
  }

  const obj = spec as {
    handler?: unknown;
    request?: unknown;
    query?: unknown;
    middleware?: ReadonlyArray<MiddlewareSpec>;
    bodyParsing?: 'parsed' | 'raw' | 'none';
    description?: unknown;
  };

  if (typeof obj.handler !== 'function') {
    return null;
  }

  const handlerName = obj.handler.name;
  const entry: HandlerEntry = {
    // biome-ignore lint/complexity/noBannedTypes: handler is a user-provided callable
    handler: (obj.handler as Function).bind(controller),
    meta: {
      methodName: handlerName || undefined,
      ...(typeof obj.description === 'string'
        ? { description: obj.description }
        : {}),
    },
  };
  if (obj.request != null) {
    // biome-ignore lint/suspicious/noExplicitAny: Standard Schema validator passthrough
    entry.request = obj.request as any;
  }
  if (obj.query != null) {
    // biome-ignore lint/suspicious/noExplicitAny: Standard Schema validator passthrough
    entry.query = obj.query as any;
  }
  if (obj.bodyParsing) {
    entry.bodyParsing = obj.bodyParsing;
  }
  if (Array.isArray(obj.middleware) && obj.middleware.length > 0) {
    entry.middlewares = normalizeMiddlewares(obj.middleware);
  }
  return entry;
}

function attachHandler(
  subtree: RouteNode,
  method: HttpMethod,
  pathStr: string,
  entry: HandlerEntry,
): void {
  const target = walkToNode(subtree, pathStr);
  if (!target.methods) {
    target.methods = {};
  }
  if (target.methods[method]) {
    throw new Error(
      `ControllerManager: duplicate handler for ${method} ${pathStr}`,
    );
  }
  const segments = pathStr.split('/').filter((s) => s.length > 0);
  const paramNames: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith(':') || seg.startsWith('*')) {
      paramNames.push(seg.slice(1));
    }
  }
  if (paramNames.length > 0) {
    entry.paramNames = paramNames;
  }
  target.methods[method] = entry;
}

/**
 * Attach middlewares to the right tree position.
 *
 * - `ALL` + path → node-level middlewares (apply to all methods at the
 *   path + descendants via walk).
 * - `METHOD` + specific path → prepend to the handler's middleware list
 *   so they run before any route-level middlewares.
 * - `METHOD` + splat (e.g. `'PUT/{*splat}'`) → walk the subtree at the
 *   splat's parent and attach to every handler that matches the method.
 */
function attachMiddlewares(
  subtree: RouteNode,
  method: HttpMethod | 'ALL',
  pathStr: string,
  entries: MiddlewareEntry[],
): void {
  const segments = pathStr.split('/').filter((s) => s.length > 0);

  const hasSplat =
    segments.length > 0 && segments[segments.length - 1]?.startsWith('*');
  if (hasSplat) {
    segments.pop();
  }

  let target = subtree;
  for (const seg of segments) {
    target = ensureChildSegment(target, seg);
  }

  if (method === 'ALL') {
    target.middlewares.push(...entries);
    return;
  }

  if (hasSplat) {
    attachToMethodHandlers(target, method, entries);
    return;
  }

  const existingHandler = target.methods?.[method];
  if (existingHandler) {
    existingHandler.middlewares = [
      ...entries,
      ...(existingHandler.middlewares ?? []),
    ];
  }
}

/** Walk a subtree, attaching mws to every handler that matches `method`. */
function attachToMethodHandlers(
  node: RouteNode,
  method: HttpMethod,
  entries: MiddlewareEntry[],
): void {
  const handler = node.methods?.[method];
  if (handler) {
    handler.middlewares = [...entries, ...(handler.middlewares ?? [])];
  }
  for (const child of node.children.values()) {
    attachToMethodHandlers(child, method, entries);
  }
  if (node.paramChild) {
    attachToMethodHandlers(node.paramChild, method, entries);
  }
  if (node.splatChild) {
    attachToMethodHandlers(node.splatChild, method, entries);
  }
}

function walkToNode(subtree: RouteNode, pathStr: string): RouteNode {
  const segments = pathStr.split('/').filter((s) => s.length > 0);
  let target = subtree;
  for (const seg of segments) {
    target = ensureChildSegment(target, seg);
  }
  return target;
}

function ensureChildSegment(node: RouteNode, segment: string): RouteNode {
  if (segment.startsWith(':')) {
    if (!node.paramChild) {
      node.paramChild = createNode(segment);
    }
    return node.paramChild;
  }
  if (segment.startsWith('*')) {
    if (!node.splatChild) {
      node.splatChild = createNode(segment);
    }
    return node.splatChild;
  }
  let child = node.children.get(segment);
  if (!child) {
    child = createNode(segment);
    node.children.set(segment, child);
  }
  return child;
}

export default ControllerManager;
