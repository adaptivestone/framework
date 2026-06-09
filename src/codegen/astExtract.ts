/**
 * Codegen AST extractor (plan: `.plans/refactor/queued/codegen-ast.md` · design:
 * `docs/codegen-ast-approach.md`). Parses a controller's source with **oxc** and
 * reads, declaratively from the AST, everything the codegen front-end needs — this
 * (with `astResolve`/`astEmit`) is the whole front-end; the old regex/char-loop
 * reconstruction and boot-time reflection have been removed.
 *
 * Per controller source it returns:
 *   - `imports`:    binding → { specifier, kind, orig? }. Keyed on the LOCAL
 *                   import binding, read straight off the import node — so the
 *                   binding-vs-class-name problem (`import Auth` for class
 *                   `AuthMiddleware`) that `importResolution` solved by live-class
 *                   identity matching simply never arises.
 *   - `extendsName`: the EXPORTED class's parent identifier (or `null`).
 *   - `routes`:     method → path → { handler, hasRequest, hasQuery }.
 *   - `middleware`: name-tagged `[{ scope, bindings }]`, or `undefined` when the
 *                   controller declares none (inherits its parent's).
 *
 * `routes` and `middleware` are extracted INDEPENDENTLY: a dynamic `routes` getter
 * doesn't discard a literal `middleware` Map (the base `AbstractController` has
 * exactly that shape — a `logger.warn` + stub `return {}` for routes, a literal
 * Map for middleware). When a getter isn't a literal structure, the relevant
 * aspect is flagged via `ok: false` / `reason`; codegen can't statically analyze
 * that controller and the run throws (no boot fallback — declarative-only).
 *
 * oxc, not the TypeScript API: `ts.createSourceFile` is dropped in TS 7's Go port;
 * oxc is a stable in-process napi parser, and codegen needs only syntactic
 * extraction (it emits type expressions; it never resolves types).
 */

import { parseSync } from 'oxc-parser';

export interface ImportInfo {
  specifier: string;
  kind: 'default' | 'named' | 'namespace';
  /** Original export name when the binding is a renamed named import. */
  orig?: string;
}

export interface RouteInfo {
  method: string;
  path: string;
  /** Handler method name (`this.<handler>`), or `null` if unidentifiable. */
  handler: string | null;
  hasRequest: boolean;
  hasQuery: boolean;
  /** Media-type keys when `request` is a content-type map (`{ 'application/json':
   * … }`); absent for a single-schema request. */
  requestContentTypes?: string[];
  /** Route-level middleware binding names (`{ handler, middleware: [X] }`). */
  middleware?: string[];
}

export interface MiddlewareScope {
  scope: string;
  bindings: string[];
}

export interface ExtractResult {
  /** False when a getter isn't a literal structure → not statically analyzable. */
  ok: boolean;
  reason?: string;
  className?: string;
  extendsName?: string | null;
  imports: Record<string, ImportInfo>;
  routes: RouteInfo[];
  /** `undefined` = no own middleware (inherits); `[]` is a real empty map. */
  middleware?: MiddlewareScope[];
  /** Literal `getHttpPath()` return (e.g. `'/'`), if the method returns a string
   * literal. `undefined` = method not defined (caller uses the default mount). */
  httpPath?: string;
  /** `getHttpPath()` is defined but not a literal return → mount path unknown. */
  httpPathDynamic?: boolean;
}

// oxc emits an ESTree-shaped AST; we walk it structurally (no type info needed).
// biome-ignore lint/suspicious/noExplicitAny: untyped ESTree nodes from the parser
type Node = any;

/** Parse a controller source and extract its declarative codegen shape. */
export function extractController(
  src: string,
  fileName: string,
): ExtractResult {
  const { program, errors } = parseSync(fileName, src);
  if (errors.length) {
    return {
      ok: false,
      reason: `parse error: ${errors[0]?.message ?? 'unknown'}`,
      imports: {},
      routes: [],
    };
  }

  const imports = collectImports(program.body);
  const cls = findExportedClass(program.body);
  if (!cls) {
    return {
      ok: false,
      reason: 'no exported class found',
      imports,
      routes: [],
    };
  }

  const extendsName = readExtends(cls);
  const routesNode = findAccessor(cls, 'routes', /* isStatic */ false);
  const mwNode = findAccessor(cls, 'middleware', /* isStatic */ true);

  let routes: RouteInfo[] = [];
  let routesFailed: string | undefined;
  if (routesNode) {
    const r = extractRoutes(routesNode);
    if (r.ok) {
      routes = r.routes;
    } else {
      routesFailed = r.reason;
    }
  }

  let middleware: MiddlewareScope[] | undefined;
  let mwFailed: string | undefined;
  if (mwNode) {
    const m = extractMiddleware(mwNode);
    if (m.ok) {
      middleware = m.scopes;
    } else {
      mwFailed = m.reason;
    }
  }

  // getHttpPath(): a literal-string return gives the mount path; a non-literal
  // body means the mount is unknown to static analysis (→ caller falls back).
  const httpPathNode = cls.body.body.find(
    (m: Node) =>
      m.type === 'MethodDefinition' &&
      m.kind === 'method' &&
      !m.static &&
      !m.computed &&
      propName(m.key) === 'getHttpPath',
  );
  let httpPath: string | undefined;
  let httpPathDynamic = false;
  if (httpPathNode) {
    const ret = literalReturn(httpPathNode);
    if (ret?.type === 'Literal' && typeof ret.value === 'string') {
      httpPath = ret.value;
    } else {
      httpPathDynamic = true;
    }
  }

  const reason = routesFailed
    ? `routes getter not a literal: ${routesFailed}`
    : mwFailed
      ? `middleware getter not a literal Map: ${mwFailed}`
      : httpPathDynamic
        ? 'getHttpPath() is not a literal-string return'
        : undefined;

  return {
    ok: !reason,
    reason,
    className: cls.id?.name,
    extendsName,
    imports,
    routes,
    middleware,
    httpPath,
    httpPathDynamic,
  };
}

// ─── imports ─────────────────────────────────────────────────────────────────

function collectImports(body: Node[]): Record<string, ImportInfo> {
  const out: Record<string, ImportInfo> = {};
  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') {
      continue;
    }
    if (stmt.importKind === 'type') {
      continue; // value imports only (middleware / extends are value imports)
    }
    const specifier = stmt.source.value as string;
    for (const spec of stmt.specifiers ?? []) {
      if (spec.importKind === 'type') {
        continue;
      }
      if (spec.type === 'ImportDefaultSpecifier') {
        out[spec.local.name] = { specifier, kind: 'default' };
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        out[spec.local.name] = { specifier, kind: 'namespace' };
      } else if (spec.type === 'ImportSpecifier') {
        out[spec.local.name] = {
          specifier,
          kind: 'named',
          ...(spec.imported && spec.imported.name !== spec.local.name
            ? { orig: spec.imported.name }
            : {}),
        };
      }
    }
  }
  return out;
}

// ─── exported class + extends ────────────────────────────────────────────────

function findExportedClass(body: Node[]): Node | undefined {
  const classes = body.filter((n) => n.type === 'ClassDeclaration');
  // `export default class …` (default preferred over a named export)
  for (const n of body) {
    if (
      n.type === 'ExportDefaultDeclaration' &&
      n.declaration?.type === 'ClassDeclaration'
    ) {
      return n.declaration;
    }
  }
  // `export class …`
  for (const n of body) {
    if (
      n.type === 'ExportNamedDeclaration' &&
      n.declaration?.type === 'ClassDeclaration'
    ) {
      return n.declaration;
    }
  }
  // `class X {} … export default X`
  for (const n of body) {
    if (
      n.type === 'ExportDefaultDeclaration' &&
      n.declaration?.type === 'Identifier'
    ) {
      const named = classes.find((c) => c.id?.name === n.declaration.name);
      if (named) {
        return named;
      }
    }
  }
  return classes[classes.length - 1]; // last class as a last resort
}

function readExtends(cls: Node): string | null {
  // Only a bare identifier is a resolvable parent. `ns.Base` (MemberExpression) /
  // `mixin(Base)` (CallExpression) → null (caller treats as "no walkable parent").
  return cls.superClass?.type === 'Identifier' ? cls.superClass.name : null;
}

// ─── routes ──────────────────────────────────────────────────────────────────

function extractRoutes(
  node: Node,
): { ok: true; routes: RouteInfo[] } | { ok: false; reason: string } {
  const obj = literalReturn(node);
  if (obj?.type !== 'ObjectExpression') {
    return { ok: false, reason: 'not a single `return { … }`' };
  }
  const routes: RouteInfo[] = [];
  for (const methodProp of obj.properties) {
    if (methodProp.type !== 'Property' || methodProp.computed) {
      return { ok: false, reason: 'non-literal/computed method entry' };
    }
    const method = propName(methodProp.key);
    if (method === null) {
      return { ok: false, reason: 'computed method key' };
    }
    if (methodProp.value.type !== 'ObjectExpression') {
      return { ok: false, reason: `method '${method}' value not a literal` };
    }
    for (const routeProp of methodProp.value.properties) {
      if (routeProp.type !== 'Property' || routeProp.computed) {
        return { ok: false, reason: 'non-literal/computed route entry' };
      }
      const p = propName(routeProp.key);
      if (p === null) {
        return { ok: false, reason: 'computed route key' };
      }
      // Some route-entry features affect the emitted chain/types but aren't read
      // by this extractor (a content-type request map needs media-type keys;
      // route-level `middleware` adds to the chain). Flag such a controller as
      // unanalyzable (→ hard error) rather than misrender it.
      const unanalyzable = unanalyzableRoute(routeProp.value);
      if (unanalyzable) {
        return { ok: false, reason: `route uses ${unanalyzable}` };
      }
      routes.push(readRouteEntry(method, p, routeProp.value));
    }
  }
  return { ok: true, routes };
}

/** A route-entry shape this extractor can't read (→ `ok: false`, hard error), or
 * null. Content-type maps and route-level middleware ARE extracted (below); only
 * their unanalyzable variants — a request map with computed/spread keys, or a
 * `middleware` value that isn't a literal array of binding identifiers — flag. */
function unanalyzableRoute(init: Node): string | null {
  if (init.type !== 'ObjectExpression') {
    return null;
  }
  for (const prop of init.properties) {
    if (prop.type !== 'Property') {
      continue;
    }
    const key = propName(prop.key);
    if (
      key === 'request' &&
      prop.value?.type === 'ObjectExpression' &&
      !objectKeys(prop.value)
    ) {
      return 'a request map with computed/spread keys';
    }
    if (key === 'middleware' && middlewareBindings(prop.value) === undefined) {
      return 'unanalyzable route-level middleware';
    }
  }
  return null;
}

function readRouteEntry(method: string, path: string, init: Node): RouteInfo {
  // Bare handler: `'/logout': this.postLogout`
  if (
    init.type === 'MemberExpression' &&
    init.object?.type === 'ThisExpression'
  ) {
    return {
      method,
      path,
      handler: init.property?.name ?? null,
      hasRequest: false,
      hasQuery: false,
    };
  }
  // `{ handler: this.x, request?, query?, middleware? }`
  if (init.type === 'ObjectExpression') {
    const out: RouteInfo = {
      method,
      path,
      handler: null,
      hasRequest: false,
      hasQuery: false,
    };
    for (const prop of init.properties) {
      if (prop.type !== 'Property') {
        continue;
      }
      const key = propName(prop.key);
      if (key === 'handler' && prop.value.type === 'MemberExpression') {
        out.handler = prop.value.property?.name ?? null;
      } else if (key === 'request') {
        out.hasRequest = true; // the VALUE (defineSchema(...)) is never evaluated
        // A content-type map → its media-type keys (mirrors the runtime
        // `isContentTypeRequestMap`: a plain object whose keys all contain `/`).
        const keys = objectKeys(prop.value);
        if (keys && keys.length > 0 && keys.every((k) => k.includes('/'))) {
          out.requestContentTypes = keys;
        }
      } else if (key === 'query') {
        out.hasQuery = true;
      } else if (key === 'middleware') {
        out.middleware = middlewareBindings(prop.value);
      }
    }
    return out;
  }
  return { method, path, handler: null, hasRequest: false, hasQuery: false };
}

/** The literal keys of an object expression, or `null` if any is computed/spread. */
function objectKeys(value: Node): string[] | null {
  if (value.type !== 'ObjectExpression') {
    return null;
  }
  const keys: string[] = [];
  for (const p of value.properties) {
    if (p.type !== 'Property' || p.computed) {
      return null;
    }
    const k = propName(p.key);
    if (k === null) {
      return null;
    }
    keys.push(k);
  }
  return keys;
}

/** Binding names from a `[X, [Y, params]]` middleware array, or `undefined` if
 * the value isn't a literal array of binding identifiers. */
function middlewareBindings(value: Node): string[] | undefined {
  if (value.type !== 'ArrayExpression') {
    return undefined;
  }
  const out: string[] = [];
  for (const el of value.elements) {
    if (el?.type === 'Identifier') {
      out.push(el.name);
    } else if (
      el?.type === 'ArrayExpression' &&
      el.elements[0]?.type === 'Identifier'
    ) {
      out.push(el.elements[0].name);
    } else {
      return undefined;
    }
  }
  return out;
}

// ─── middleware ──────────────────────────────────────────────────────────────

function extractMiddleware(
  node: Node,
): { ok: true; scopes: MiddlewareScope[] } | { ok: false; reason: string } {
  const ret = literalReturn(node);
  if (
    ret?.type !== 'NewExpression' ||
    ret.callee?.type !== 'Identifier' ||
    ret.callee.name !== 'Map'
  ) {
    return { ok: false, reason: 'not `return new Map([ … ])`' };
  }
  const arg = ret.arguments?.[0];
  if (!arg) {
    return { ok: true, scopes: [] }; // `new Map()` — a valid empty middleware map
  }
  if (arg.type !== 'ArrayExpression') {
    return { ok: false, reason: 'Map arg not an array literal' };
  }
  const scopes: MiddlewareScope[] = [];
  for (const pair of arg.elements) {
    if (pair?.type !== 'ArrayExpression' || pair.elements.length < 2) {
      return { ok: false, reason: 'Map entry not a `[scope, [...]]` tuple' };
    }
    const [scopeNode, listNode] = pair.elements;
    if (scopeNode?.type !== 'Literal' || typeof scopeNode.value !== 'string') {
      return { ok: false, reason: 'scope key not a string literal' };
    }
    if (listNode?.type !== 'ArrayExpression') {
      return { ok: false, reason: 'middleware list not an array literal' };
    }
    const bindings: string[] = [];
    for (const el of listNode.elements) {
      if (el?.type === 'Identifier') {
        bindings.push(el.name); // `Mw`
      } else if (
        el?.type === 'ArrayExpression' &&
        el.elements[0]?.type === 'Identifier'
      ) {
        bindings.push(el.elements[0].name); // `[Mw, params]`
      } else {
        return {
          ok: false,
          reason: 'middleware entry not a binding identifier',
        };
      }
    }
    scopes.push({ scope: scopeNode.value, bindings });
  }
  return { ok: true, scopes };
}

// ─── small AST helpers ───────────────────────────────────────────────────────

function findAccessor(
  cls: Node,
  name: string,
  isStatic: boolean,
): Node | undefined {
  for (const m of cls.body.body) {
    if (m.static !== isStatic) {
      continue;
    }
    const isGetter = m.type === 'MethodDefinition' && m.kind === 'get';
    const isProp = m.type === 'PropertyDefinition';
    if ((isGetter || isProp) && !m.computed && propName(m.key) === name) {
      return m;
    }
  }
  return undefined;
}

/** The single `return <expr>` of a getter body, or a property's initializer. */
function literalReturn(node: Node): Node | undefined {
  if (node.type === 'PropertyDefinition') {
    return node.value ?? undefined;
  }
  // MethodDefinition → FunctionExpression → BlockStatement
  const body = node.value?.body;
  if (body?.type !== 'BlockStatement' || body.body.length !== 1) {
    return undefined;
  }
  const only = body.body[0];
  return only.type === 'ReturnStatement'
    ? (only.argument ?? undefined)
    : undefined;
}

function propName(key: Node): string | null {
  if (key.type === 'Identifier') {
    return key.name;
  }
  if (key.type === 'Literal' && key.value != null) {
    return String(key.value);
  }
  return null; // computed / unsupported
}
