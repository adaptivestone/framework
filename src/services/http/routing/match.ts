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
 * Two deliberate semantics:
 * - A `{*splat}` matches ZERO trailing segments, so `/api/{*rest}` matches
 *   `/api` (with `rest: ''`).
 * - A method-less structural node is NOT a match: walking to a dead end fails
 *   and backtracks to param/splat siblings (so `/users/me` still matches
 *   `/users/:id` even when `/users/me/avatar` created a method-less `me` node).
 */

import type {
  BodyParsingMode,
  HandlerEntry,
  HttpMethod,
  MatchResult,
  MiddlewareEntry,
  RouteNode,
} from './RouteNode.ts';

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
  middlewares: MiddlewareEntry[];
  params: Record<string, string>;
  paramValues: string[];
  bodyParsing: BodyParsingMode | undefined;
}

/**
 * - `null` → no path match (404).
 * - `{ entry: null, allowedMethods }` → path matched, method didn't (405).
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

  const result = walk(root, segments, 0, [], {}, [], undefined);
  if (!result) {
    return null;
  }

  const methods = result.node.methods;
  if (!methods || Object.keys(methods).length === 0) {
    return null;
  }

  const handler = resolveHandler(methods, upMethod);
  const allowedMethods = Object.keys(methods) as HttpMethod[];
  if (methods.GET && !methods.HEAD) {
    allowedMethods.push('HEAD');
  }

  let params = result.params;
  if (handler?.paramNames && result.paramValues.length > 0) {
    params = {};
    for (let i = 0; i < handler.paramNames.length; i++) {
      params[handler.paramNames[i] as string] = result.paramValues[i] as string;
    }
  }

  return {
    entry: handler,
    allowedMethods,
    middlewares: handler
      ? [...result.middlewares, ...(handler.middlewares ?? [])]
      : result.middlewares,
    params,
    bodyParsing: handler?.bodyParsing ?? result.bodyParsing ?? 'parsed',
  };
}

function nodeHasMethods(node: RouteNode): boolean {
  return !!node.methods && Object.keys(node.methods).length > 0;
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

function walk(
  node: RouteNode,
  segments: string[],
  index: number,
  parentMw: MiddlewareEntry[],
  parentParams: Record<string, string>,
  parentParamValues: string[],
  parentBodyParsing: BodyParsingMode | undefined,
): WalkResult | null {
  const middlewares = [...parentMw, ...node.middlewares];
  const bodyParsing = node.bodyParsing ?? parentBodyParsing;

  if (index === segments.length) {
    if (nodeHasMethods(node)) {
      return {
        node,
        middlewares,
        params: parentParams,
        paramValues: parentParamValues,
        bodyParsing,
      };
    }
    // Zero-segment splat: a method-less node with a splat child that HAS
    // methods matches the splat as ''.
    if (node.splatChild && nodeHasMethods(node.splatChild)) {
      const splatName = node.splatChild.segment.slice(1);
      return {
        node: node.splatChild,
        middlewares: [...middlewares, ...node.splatChild.middlewares],
        params: { ...parentParams, [splatName]: '' },
        paramValues: [...parentParamValues, ''],
        bodyParsing: node.splatChild.bodyParsing ?? bodyParsing,
      };
    }
    // Dead-end structural node: fail so the caller falls through to its
    // param/splat siblings instead of reporting a spurious 404.
    return null;
  }

  const seg = segments[index] as string;

  const staticChild = lookupStaticChild(node.children, seg);
  if (staticChild) {
    const result = walk(
      staticChild,
      segments,
      index + 1,
      middlewares,
      parentParams,
      parentParamValues,
      bodyParsing,
    );
    if (result) {
      return result;
    }
  }

  if (node.paramChild) {
    const paramName = node.paramChild.segment.slice(1);
    const result = walk(
      node.paramChild,
      segments,
      index + 1,
      middlewares,
      { ...parentParams, [paramName]: seg },
      [...parentParamValues, seg],
      bodyParsing,
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
      segments,
      segments.length,
      middlewares,
      { ...parentParams, [splatName]: splatValue },
      [...parentParamValues, splatValue],
      bodyParsing,
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
