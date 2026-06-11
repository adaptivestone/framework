/**
 * Global route tree. One instance per app, lives on `app.routeRegistry`.
 *
 * Producers (controllers, ad-hoc routes) register subtrees here. Consumers
 * (the runtime adapter, codegen, OpenAPI / MCP emitters) walk it.
 */

import { match } from './match.ts';
import type {
  BodyParsingMode,
  FlatRoute,
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
    const prefixParamNames: string[] = [];
    for (const seg of pathSegments(prefix)) {
      if (seg.startsWith(':') || seg.startsWith('*')) {
        prefixParamNames.push(seg.slice(1));
      }
      target = ensureChildBySegment(target, seg);
    }
    // A handler's `paramNames` only covers params in its OWN path, not in the
    // mount prefix. `match()` zips paramNames against ALL collected values by
    // index, so prefix params must be prepended or the values mis-align.
    if (prefixParamNames.length > 0) {
      prependParamNames(subtree, prefixParamNames);
    }
    mergeNode(target, subtree);
  }

  /**
   * Register a single ad-hoc route. Escape hatch for routes that don't
   * fit the controller convention (webhooks, healthchecks, OAuth callbacks).
   */
  registerRoute(method: HttpMethod, path: string, entry: HandlerEntry): void {
    let target = this.root;
    const paramNames: string[] = [];
    for (const seg of pathSegments(path)) {
      if (seg.startsWith(':') || seg.startsWith('*')) {
        paramNames.push(seg.slice(1));
      }
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
    if (paramNames.length > 0) {
      entry.paramNames = paramNames;
    }
    target.methods[method] = entry;
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
    return match(this.root, method, path);
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
  if (node.segment.startsWith('*')) {
    throw new Error(
      `RouteRegistry: cannot register a child segment "${segment}" under a splat segment "${node.segment}" — splat consumes the rest of the path, so this child would be unreachable`,
    );
  }
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
  // Static children are keyed by lowercase segment so case-insensitive matching
  // is an O(1) `Map.get` (no per-request scan). The node keeps the original-cased
  // `segment` for display and case-sensitive matching. Segments differing only by
  // case fold onto one node (insensitive matching already treated them as one);
  // a same-method collision then surfaces via the conflicting-handler error.
  const key = segment.toLowerCase();
  let child = node.children.get(key);
  if (!child) {
    child = createNode(segment);
    node.children.set(key, child);
  }
  return child;
}

/**
 * Prepend mount-prefix param names to every handler in the subtree that already
 * carries a `paramNames` array. Handlers without `paramNames` rely on `match()`'s
 * tree-segment-name fallback, which already accounts for the prefix nodes.
 */
function prependParamNames(node: RouteNode, prefixNames: string[]): void {
  if (node.methods) {
    for (const m of Object.keys(node.methods) as HttpMethod[]) {
      const handler = node.methods[m];
      if (handler?.paramNames) {
        handler.paramNames = [...prefixNames, ...handler.paramNames];
      }
    }
  }
  for (const child of node.children.values()) {
    prependParamNames(child, prefixNames);
  }
  if (node.paramChild) {
    prependParamNames(node.paramChild, prefixNames);
  }
  if (node.splatChild) {
    prependParamNames(node.splatChild, prefixNames);
  }
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
    // Normalize to the lowercase key scheme (see ensureChildBySegment) so a
    // subtree built elsewhere still merges by case-folded segment.
    const key = seg.toLowerCase();
    const existing = target.children.get(key);
    if (existing) {
      mergeNode(existing, child);
    } else {
      target.children.set(key, child);
    }
  }

  if (source.paramChild) {
    if (target.paramChild) {
      mergeNode(target.paramChild, source.paramChild);
    } else {
      target.paramChild = source.paramChild;
    }
  }

  if (source.splatChild) {
    if (target.splatChild) {
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
