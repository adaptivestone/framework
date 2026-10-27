/**
 * Tree-walk matcher. Pure function.
 *
 * Specificity: static children → paramChild → splatChild. Per-segment
 * URL decoding (Spring's `PathPatternParser` model): keeps `%2F` inside
 * a segment instead of letting it act as a separator.
 *
 * Splat captures the rest of the path AFTER per-segment decoding, so
 * `/a/foo%2Fbar/baz` and `/a/foo/bar/baz` produce the same splat value.
 * Documented trade-off — handle the rare encoded-slash case in `'raw'`
 * body mode if needed.
 *
 * Deliberate semantics:
 * - A `{*splat}` matches ZERO trailing segments, so `/api/{*rest}` matches
 *   `/api` (with `rest: ''`).
 * - A method-less structural node is NOT a match: walking to a dead end fails
 *   and backtracks to param/splat siblings (so `/users/me` still matches
 *   `/users/:id` even when `/users/me/avatar` created a method-less `me` node).
 * - Matching is method-aware: a node without the request's method does not
 *   end the walk either, so `DELETE /events/new` reaches `DELETE /events/:slug`
 *   next to a GET-only `/events/new`. 405 only when no route matching the path
 *   has the method; `Allow` lists the methods of all of them.
 */

import type {
  BodyParsingMode,
  HandlerEntry,
  HttpMethod,
  MatchResult,
  MiddlewareEntry,
  RouteNode,
} from './RouteNode.ts';

// Runtime adapter metadata, separate from the public match-result contract.
// Nodes identify routes even when callers reuse one handler entry at many paths.
const matchedNodes = new WeakMap<MatchResult, RouteNode>();

export function getMatchedNode(result: MatchResult): RouteNode | undefined {
  return matchedNodes.get(result);
}

/** Thrown when a path contains a malformed `%XX` sequence. */
export class MalformedPathError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'MalformedPathError';
  }
}

interface WalkResult {
  node: RouteNode;
  handler: HandlerEntry | null;
  middlewares: MiddlewareEntry[];
  params: Record<string, string>;
  paramValues: string[];
  bodyParsing: BodyParsingMode | undefined;
}

/**
 * - `null` → no path match (404).
 * - `{ entry: null, allowedMethods }` → path matched, but no matching route
 *   has the method (405).
 * - full result → success.
 */
export function match(
  root: RouteNode,
  method: string,
  path: string,
): MatchResult | null {
  const upMethod = method.toUpperCase() as HttpMethod;
  const segments = pathToSegments(path);

  // An empty segment (from `//`) is unroutable — it must never match a param as
  // ''. The path is well-formed (not a MalformedPathError), just a 404.
  if (segments.includes('')) {
    return null;
  }

  // Path matches whose node lacks the method, most specific first.
  const misses: WalkResult[] = [];
  const hit = walk(root, upMethod, segments, 0, [], {}, [], undefined, misses);
  const result = hit ?? misses[0];
  if (!result) {
    return null;
  }

  const handler = result.handler;
  const allowedMethods = hit
    ? allowedMethodsOf(hit.node)
    : [...new Set(misses.flatMap((miss) => allowedMethodsOf(miss.node)))];

  let params = result.params;
  if (handler?.paramNames && result.paramValues.length > 0) {
    params = {};
    for (let i = 0; i < handler.paramNames.length; i++) {
      params[handler.paramNames[i] as string] = result.paramValues[i] as string;
    }
  }

  const matched: MatchResult = {
    entry: handler,
    allowedMethods,
    middlewares: handler
      ? [...result.middlewares, ...(handler.middlewares ?? [])]
      : result.middlewares,
    params,
    bodyParsing: handler?.bodyParsing ?? result.bodyParsing ?? 'parsed',
  };
  matchedNodes.set(matched, result.node);
  return matched;
}

function allowedMethodsOf(node: RouteNode): HttpMethod[] {
  const methods = node.methods ?? {};
  const allowed = Object.keys(methods) as HttpMethod[];
  if (methods.GET && !methods.HEAD) {
    allowed.push('HEAD');
  }
  return allowed;
}

function resolveHandler(
  methods: NonNullable<RouteNode['methods']>,
  method: HttpMethod,
): HandlerEntry | null {
  const direct = methods[method];
  if (direct) {
    return direct;
  }
  if (method === 'HEAD' && methods.GET) {
    return methods.GET;
  }
  return null;
}

/**
 * End of the path at `node`. Returns a hit when the node serves `method`;
 * a node with other methods is recorded in `misses` (405 candidate) and the
 * walk goes on. A method-less node is a dead end: the caller falls through to
 * its param/splat siblings instead of reporting a spurious 404.
 */
function arrive(
  node: RouteNode,
  method: HttpMethod,
  middlewares: MiddlewareEntry[],
  params: Record<string, string>,
  paramValues: string[],
  bodyParsing: BodyParsingMode | undefined,
  misses: WalkResult[],
): WalkResult | null {
  const methods = node.methods;
  if (!methods || Object.keys(methods).length === 0) {
    return null;
  }
  const handler = resolveHandler(methods, method);
  const result = {
    node,
    handler,
    middlewares,
    params,
    paramValues,
    bodyParsing,
  };
  if (handler) {
    return result;
  }
  misses.push(result);
  return null;
}

function walk(
  node: RouteNode,
  method: HttpMethod,
  segments: string[],
  index: number,
  parentMw: MiddlewareEntry[],
  parentParams: Record<string, string>,
  parentParamValues: string[],
  parentBodyParsing: BodyParsingMode | undefined,
  misses: WalkResult[],
): WalkResult | null {
  const middlewares = [...parentMw, ...node.middlewares];
  const bodyParsing = node.bodyParsing ?? parentBodyParsing;

  if (index === segments.length) {
    const exact = arrive(
      node,
      method,
      middlewares,
      parentParams,
      parentParamValues,
      bodyParsing,
      misses,
    );
    if (exact || !node.splatChild) {
      return exact;
    }
    // Zero-segment splat: the splat child matches the empty rest as ''.
    const splatName = node.splatChild.segment.slice(1);
    return arrive(
      node.splatChild,
      method,
      [...middlewares, ...node.splatChild.middlewares],
      { ...parentParams, [splatName]: '' },
      [...parentParamValues, ''],
      node.splatChild.bodyParsing ?? bodyParsing,
      misses,
    );
  }

  const seg = segments[index] as string;

  const staticChild = lookupStaticChild(node.children, seg);
  if (staticChild) {
    const result = walk(
      staticChild,
      method,
      segments,
      index + 1,
      middlewares,
      parentParams,
      parentParamValues,
      bodyParsing,
      misses,
    );
    if (result) {
      return result;
    }
  }

  if (node.paramChild) {
    const paramName = node.paramChild.segment.slice(1);
    const result = walk(
      node.paramChild,
      method,
      segments,
      index + 1,
      middlewares,
      { ...parentParams, [paramName]: seg },
      [...parentParamValues, seg],
      bodyParsing,
      misses,
    );
    if (result) {
      return result;
    }
  }

  if (node.splatChild) {
    const splatName = node.splatChild.segment.slice(1);
    const splatValue = segments.slice(index).join('/');
    const result = walk(
      node.splatChild,
      method,
      segments,
      segments.length,
      middlewares,
      { ...parentParams, [splatName]: splatValue },
      [...parentParamValues, splatValue],
      bodyParsing,
      misses,
    );
    if (result) {
      return result;
    }
  }

  return null;
}

function lookupStaticChild(
  children: Map<string, RouteNode>,
  seg: string,
): RouteNode | undefined {
  // Children are keyed by lowercase segment (set at registration), so matching
  // is a plain O(1) get — no per-request linear scan. Matching is always
  // case-insensitive (Express's lenient default); a case-sensitive mode is a
  // v6 concern and is not wired here.
  return children.get(seg.toLowerCase());
}

function pathToSegments(path: string): string[] {
  let trimmed = path.startsWith('/') ? path.slice(1) : path;
  // Lenient trailing slash: `/users/` matches `/users`.
  if (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed === '') {
    return [];
  }
  return trimmed.split('/').map(decodeSegment);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new MalformedPathError(`malformed URI sequence: "${segment}"`);
  }
}
