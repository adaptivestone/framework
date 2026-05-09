/**
 * Global route tree. One instance per app, lives on `app.routeRegistry`.
 *
 * Producers (controllers, ad-hoc routes, the project boot hook) register
 * subtrees and global middleware here. Consumers (the runtime adapter,
 * codegen, OpenAPI / MCP emitters) walk it.
 */

import { type MatchOptions, match } from './match.ts';
import {
  type MiddlewareSpec,
  normalizeMiddleware,
} from './middlewareNormalization.ts';
import type {
  BodyParsingMode,
  FlatRoute,
  GlobalMiddlewarePosition,
  HandlerEntry,
  HttpMethod,
  MatchResult,
  MiddlewareEntry,
  RouteNode,
} from './RouteNode.ts';

/** Construct an empty node with the given segment. */
export function createNode(segment: string): RouteNode {
  return {
    segment,
    middlewares: [],
    children: new Map(),
  };
}

export class RouteRegistry {
  readonly root: RouteNode = createNode('');
  private matchOptions: MatchOptions = {};

  /** Update default match behavior (case sensitivity, trailing-slash policy). */
  setMatchOptions(options: MatchOptions): void {
    this.matchOptions = { ...this.matchOptions, ...options };
  }

  /**
   * Mount a subtree at a path prefix. Intermediate nodes are created;
   * existing ones are merged (middlewares appended, methods added,
   * children recursively merged). Conflicting handlers throw.
   *
   * The subtree's root `segment` is metadata only — its CONTENTS go
   * under `prefix` (mount-style convention). Wrap with `{ segment: '',
   * children: ... }` for clean semantics; `translateController` does
   * exactly that.
   */
  registerSubtree(prefix: string, subtree: RouteNode): void {
    let target = this.root;
    for (const seg of pathSegments(prefix)) {
      target = ensureChildBySegment(target, seg);
    }
    mergeNode(target, subtree);
  }

  /**
   * Register a single ad-hoc route. Escape hatch for routes that don't
   * fit the controller convention (webhooks, healthchecks, OAuth callbacks).
   */
  registerRoute(method: HttpMethod, path: string, entry: HandlerEntry): void {
    let target = this.root;
    for (const seg of pathSegments(path)) {
      target = ensureChildBySegment(target, seg);
    }
    if (!target.methods) {
      target.methods = {};
    }
    if (target.methods[method]) {
      throw new Error(
        `RouteRegistry: route ${method} ${path} already registered`,
      );
    }
    target.methods[method] = entry;
  }

  /**
   * Append middleware to `root.middlewares`. Accepts shorthand
   * (`Class` or `[Class, params]`) or canonical `MiddlewareEntry`;
   * short forms without `source` get a placeholder (globals aren't
   * codegen targets). `position` takes named anchors, `{ before/after:
   * 'Name' }`, or `'first'` / `'last'`.
   */
  registerGlobalMiddleware(
    middleware: MiddlewareSpec | MiddlewareEntry,
    options: {
      position?: GlobalMiddlewarePosition;
      source?: MiddlewareEntry['source'];
    } = {},
  ): void {
    const entry = isMiddlewareEntry(middleware)
      ? middleware
      : normalizeMiddleware(
          middleware,
          options.source ?? { kind: 'package', spec: '<unknown>' },
        );
    insertWithPosition(this.root.middlewares, entry, options.position);
  }

  /** Walk depth-first; `fullPath` is the slash-joined path to the node. */
  walk(visitor: (node: RouteNode, fullPath: string) => void): void {
    walkRecursive(this.root, '', visitor);
  }

  /**
   * Flatten to one entry per (method, full-path) leaf. Middlewares are
   * accumulated root → leaf; `bodyParsing` inherits leaf-wins.
   */
  flatten(): FlatRoute[] {
    const out: FlatRoute[] = [];
    flattenRecursive(this.root, '', undefined, [], out);
    return out;
  }

  /** Match a request. See `MatchResult` for return cases (404 / 405 / hit). */
  match(method: string, path: string): MatchResult | null {
    return match(this.root, method, path, this.matchOptions);
  }
}

// ─── path helpers ────────────────────────────────────────────────────

function pathSegments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function joinPath(prefix: string, segment: string): string {
  if (segment === '') {
    return prefix === '' ? '/' : prefix;
  }
  const joined = `${prefix}/${segment}`;
  return joined.startsWith('//') ? joined.slice(1) : joined;
}

// ─── tree mutation ───────────────────────────────────────────────────

function ensureChildBySegment(node: RouteNode, segment: string): RouteNode {
  // Splat consumes the rest of the path; nothing under it is reachable.
  if (node.segment.startsWith('*')) {
    throw new Error(
      `RouteRegistry: cannot register a child segment "${segment}" under a splat segment "${node.segment}" — splat consumes the rest of the path, so this child would be unreachable`,
    );
  }
  if (segment.startsWith(':')) {
    if (node.paramChild && node.paramChild.segment !== segment) {
      throw new Error(
        `RouteRegistry: conflicting param children at "${node.segment}" — ${node.paramChild.segment} vs ${segment}`,
      );
    }
    if (!node.paramChild) {
      node.paramChild = createNode(segment);
    }
    return node.paramChild;
  }
  if (segment.startsWith('*')) {
    if (node.splatChild && node.splatChild.segment !== segment) {
      throw new Error(
        `RouteRegistry: conflicting splat children at "${node.segment}" — ${node.splatChild.segment} vs ${segment}`,
      );
    }
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

function mergeNode(target: RouteNode, source: RouteNode): void {
  target.middlewares.push(...source.middlewares);

  if (source.methods) {
    if (!target.methods) {
      target.methods = {};
    }
    for (const m of Object.keys(source.methods) as HttpMethod[]) {
      const handler = source.methods[m];
      if (!handler) {
        continue;
      }
      if (target.methods[m]) {
        throw new Error(
          `RouteRegistry: conflicting handler for ${m} on segment "${target.segment}"`,
        );
      }
      target.methods[m] = handler;
    }
  }

  for (const [seg, child] of source.children) {
    const existing = target.children.get(seg);
    if (existing) {
      mergeNode(existing, child);
    } else {
      target.children.set(seg, child);
    }
  }

  if (source.paramChild) {
    if (target.paramChild) {
      if (target.paramChild.segment !== source.paramChild.segment) {
        throw new Error(
          `RouteRegistry: conflicting param children — ${target.paramChild.segment} vs ${source.paramChild.segment}`,
        );
      }
      mergeNode(target.paramChild, source.paramChild);
    } else {
      target.paramChild = source.paramChild;
    }
  }

  if (source.splatChild) {
    if (target.splatChild) {
      if (target.splatChild.segment !== source.splatChild.segment) {
        throw new Error(
          `RouteRegistry: conflicting splat children — ${target.splatChild.segment} vs ${source.splatChild.segment}`,
        );
      }
      mergeNode(target.splatChild, source.splatChild);
    } else {
      target.splatChild = source.splatChild;
    }
  }

  if (source.bodyParsing !== undefined) {
    target.bodyParsing = source.bodyParsing;
  }
}

// ─── tree traversal ──────────────────────────────────────────────────

function walkRecursive(
  node: RouteNode,
  prefix: string,
  visitor: (node: RouteNode, fullPath: string) => void,
): void {
  const fullPath = joinPath(prefix, node.segment);
  visitor(node, fullPath);
  for (const child of node.children.values()) {
    walkRecursive(child, fullPath, visitor);
  }
  if (node.paramChild) {
    walkRecursive(node.paramChild, fullPath, visitor);
  }
  if (node.splatChild) {
    walkRecursive(node.splatChild, fullPath, visitor);
  }
}

function flattenRecursive(
  node: RouteNode,
  prefix: string,
  inheritedBodyParsing: BodyParsingMode | undefined,
  inheritedMw: MiddlewareEntry[],
  out: FlatRoute[],
): void {
  const fullPath = joinPath(prefix, node.segment);
  const middlewares = [...inheritedMw, ...node.middlewares];
  const bodyParsing = node.bodyParsing ?? inheritedBodyParsing;

  if (node.methods) {
    for (const m of Object.keys(node.methods) as HttpMethod[]) {
      const entry = node.methods[m];
      if (!entry) {
        continue;
      }
      out.push({
        method: m,
        path: fullPath,
        entry,
        middlewares: [...middlewares, ...(entry.middlewares ?? [])],
        bodyParsing: entry.bodyParsing ?? bodyParsing ?? 'parsed',
      });
    }
  }

  for (const child of node.children.values()) {
    flattenRecursive(child, fullPath, bodyParsing, middlewares, out);
  }
  if (node.paramChild) {
    flattenRecursive(node.paramChild, fullPath, bodyParsing, middlewares, out);
  }
  if (node.splatChild) {
    flattenRecursive(node.splatChild, fullPath, bodyParsing, middlewares, out);
  }
}

// ─── middleware ──────────────────────────────────────────────────────

/** Type guard: full `MiddlewareEntry` vs shorthand (class or tuple). */
function isMiddlewareEntry(
  spec: MiddlewareSpec | MiddlewareEntry,
): spec is MiddlewareEntry {
  return (
    typeof spec === 'object' &&
    spec !== null &&
    !Array.isArray(spec) &&
    'Class' in spec &&
    'source' in spec
  );
}

function insertWithPosition(
  list: MiddlewareEntry[],
  middleware: MiddlewareEntry,
  position: GlobalMiddlewarePosition | undefined,
): void {
  if (
    position === undefined ||
    position === 'last' ||
    position === 'after-builtins' ||
    position === 'before-controllers'
  ) {
    list.push(middleware);
    return;
  }
  if (position === 'first' || position === 'before-builtins') {
    list.unshift(middleware);
    return;
  }
  if (typeof position === 'object') {
    const targetName = 'before' in position ? position.before : position.after;
    const idx = list.findIndex((m) => m.Class.name === targetName);
    if (idx === -1) {
      throw new Error(
        `RouteRegistry: useGlobal position references "${targetName}" but no middleware with that class name is registered`,
      );
    }
    if ('before' in position) {
      list.splice(idx, 0, middleware);
    } else {
      list.splice(idx + 1, 0, middleware);
    }
    return;
  }
  list.push(middleware);
}
