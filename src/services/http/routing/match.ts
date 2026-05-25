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

export interface MatchOptions {
  /** Default `false` — `'/Users'` matches `'/users'`. */
  caseSensitive?: boolean;
  /** Default `false` — `'/users/'` matches `'/users'`. */
  strictTrailingSlash?: boolean;
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
  options: MatchOptions = {},
): MatchResult | null {
  const upMethod = method.toUpperCase() as HttpMethod;
  const segments = pathToSegments(path, options.strictTrailingSlash ?? false);

  const result = walk(
    root,
    segments,
    0,
    [],
    {},
    [],
    undefined,
    options.caseSensitive ?? false,
  );
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
  caseSensitive: boolean,
): WalkResult | null {
  const middlewares = [...parentMw, ...node.middlewares];
  const bodyParsing = node.bodyParsing ?? parentBodyParsing;

  if (index === segments.length) {
    return {
      node,
      middlewares,
      params: parentParams,
      paramValues: parentParamValues,
      bodyParsing,
    };
  }

  const seg = segments[index] as string;

  const staticChild = lookupStaticChild(node.children, seg, caseSensitive);
  if (staticChild) {
    const result = walk(
      staticChild,
      segments,
      index + 1,
      middlewares,
      parentParams,
      parentParamValues,
      bodyParsing,
      caseSensitive,
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
      caseSensitive,
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
      caseSensitive,
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
  caseSensitive: boolean,
): RouteNode | undefined {
  if (caseSensitive) {
    return children.get(seg);
  }
  const lower = seg.toLowerCase();
  for (const [key, child] of children) {
    if (key.toLowerCase() === lower) {
      return child;
    }
  }
  return undefined;
}

function pathToSegments(path: string, strict: boolean): string[] {
  let trimmed = path.startsWith('/') ? path.slice(1) : path;
  if (!strict && trimmed.endsWith('/')) {
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
