import path from 'node:path';
import * as url from 'node:url';
import type { NextFunction, Response } from 'express';
import type AbstractController from '../modules/AbstractController.ts';
import Base from '../modules/Base.ts';
import type { IApp } from '../server.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
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
import { createNode } from '../services/http/routing/RouteRegistry.ts';
import type { StandardSchemaV1 } from '../services/validate/types.ts';
import ValidateService from '../services/validate/ValidateService.ts';

const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'ALL',
]);

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
  ): InstanceType<T> {
    const name = ControllerClass.name.toLowerCase();
    const key = prefix ? `${prefix}/${name}` : name;
    const instance = new ControllerClass(this.app, prefix) as InstanceType<T>;
    this.controllers[key] = instance;

    const registry = this.app.httpServer?.routeRegistry;
    if (!registry) {
      this.logger?.warn(
        `RouteRegistry not available; controller ${key} not registered with the new routing.`,
      );
      return instance;
    }

    const source: MiddlewareEntry['source'] = {
      kind: 'package',
      spec: `<${ControllerClass.name}>`,
    };
    const subtree = this.#buildSubtree(instance, source);
    this.#wrapHandlersInSubtree(subtree, []);
    registry.registerSubtree(instance.getHttpPath(), subtree);
    return instance;
  }

  /**
   * Auto-load controllers from the framework's internal folder and the user's
   * external folder, then register each one. User overrides win when filenames
   * collide (handled by `getFilesPathWithInheritance`).
   */
  async initControllers() {
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const controllersToLoad = await this.getFilesPathWithInheritance(
      dirname,
      this.app.foldersConfig.controllers,
    );

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
    const controllers = [];
    for (const controller of controllersToLoad) {
      controllers.push(
        import(controller.path).then(({ default: ControllerModule }) => {
          let prefix = path.dirname(controller.file);
          if (prefix === '.') {
            prefix = '';
          }
          this.registerController(ControllerModule, prefix);
        }),
      );
    }
    await Promise.all(controllers);
  }

  /**
   * Build a `RouteNode` subtree for one controller — walks `routes` getter,
   * places handlers in the tree, then attaches the `static middleware` Map
   * entries to the right tree positions. Path syntax conversion: user-facing
   * `{*splat}` → internal `*splat`. Map scope keys: `'METHOD/path'`,
   * `'ALL/path'`, `'/path'`.
   */
  #buildSubtree(
    controller: AbstractController,
    source: MiddlewareEntry['source'],
  ): RouteNode {
    const subtree = createNode('');

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
        for (const [pathKey, routeSpec] of Object.entries(routeMap)) {
          const entry = buildHandlerEntry(routeSpec, controller, source);
          if (!entry) {
            continue;
          }
          attachHandler(
            subtree,
            verb.toUpperCase() as HttpMethod,
            convertPathSyntax(pathKey),
            entry,
          );
        }
      }
    }

    // 2. Middleware Map — attach to nodes / per-handler.
    // `static get middleware()` lives on the class; instance.constructor
    // types as `Function`, so cast to read the static member.
    const ControllerClass = controller.constructor as unknown as {
      middleware?: Map<string, ReadonlyArray<MiddlewareSpec>>;
    };
    const mwMap = ControllerClass.middleware;
    if (mwMap instanceof Map) {
      for (const [scopeKey, mwList] of mwMap) {
        if (!Array.isArray(mwList) || mwList.length === 0) {
          continue;
        }
        const { method, path: scopePath } = parseScopeKey(scopeKey);
        const entries = normalizeMiddlewares(mwList, source);
        attachMiddlewares(
          subtree,
          method,
          convertPathSyntax(scopePath),
          entries,
        );
      }
    }

    return subtree;
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

    // Collect middleware-declared schemas at translation time.
    const middlewareRequestSchemas: StandardSchemaV1[] = [];
    const middlewareQuerySchemas: StandardSchemaV1[] = [];
    for (const mw of chain) {
      const inst = new mw.Class(app, mw.params ?? {});
      const r = inst.relatedReqParameters?.request;
      const q = inst.relatedReqParameters?.query;
      if (r) {
        middlewareRequestSchemas.push(r);
      }
      if (q) {
        middlewareQuerySchemas.push(q);
      }
    }

    const requestSchemas: StandardSchemaV1[] = [];
    if (entry.request) {
      requestSchemas.push(entry.request);
    }
    requestSchemas.push(...middlewareRequestSchemas);

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
        return res.status(400).json({
          errors: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        return await Promise.resolve(original(req, res, next));
      } catch (err) {
        logger?.error(err);
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

// ─── translation helpers (file-local) ────────────────────────────────

/** `'POST/login'` → method=POST,path=/login · `'/login'` → method=ALL,path=/login */
function parseScopeKey(key: string): {
  method: HttpMethod | 'ALL';
  path: string;
} {
  if (key.startsWith('/')) {
    return { method: 'ALL', path: key };
  }
  const slashIdx = key.indexOf('/');
  if (slashIdx === -1) {
    return { method: 'ALL', path: `/${key}` };
  }
  const candidate = key.slice(0, slashIdx).toUpperCase();
  if (HTTP_METHODS.has(candidate)) {
    return {
      method: candidate as HttpMethod | 'ALL',
      path: key.slice(slashIdx),
    };
  }
  return { method: 'ALL', path: `/${key}` };
}

/** `{*splat}` → `*splat`. Other syntax stays as-is. */
function convertPathSyntax(p: string): string {
  return p.replace(/\{\*([a-zA-Z_][a-zA-Z0-9_]*)\}/g, '*$1');
}

function buildHandlerEntry(
  spec: unknown,
  controller: object,
  source: MiddlewareEntry['source'],
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
  };

  if (typeof obj.handler !== 'function') {
    return null;
  }

  const handlerName = obj.handler.name;
  const entry: HandlerEntry = {
    // biome-ignore lint/complexity/noBannedTypes: handler is a user-provided callable
    handler: (obj.handler as Function).bind(controller),
    meta: { methodName: handlerName || undefined },
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
    entry.middlewares = normalizeMiddlewares(obj.middleware, source);
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
