/**
 * Codegen AST extractor (plan: `.plans/refactor/queued/codegen-ast.md` · design:
 * `docs/codegen-ast-approach.md`). Parses a controller's source with **oxc** and
 * reads, declaratively from the AST, everything the codegen front-end needs —
 * replacing the regex/char-loop reconstruction in `importResolution.ts` and the
 * boot-time reflection.
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
 * aspect is flagged via `ok: false` / `reason` so the caller can fall back to the
 * boot path for that controller (the hybrid).
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
}

export interface MiddlewareScope {
  scope: string;
  bindings: string[];
}

export interface ExtractResult {
  /** False when a getter isn't a literal structure → fall back to boot. */
  ok: boolean;
  reason?: string;
  className?: string;
  extendsName?: string | null;
  imports: Record<string, ImportInfo>;
  routes: RouteInfo[];
  /** `undefined` = no own middleware (inherits); `[]` is a real empty map. */
  middleware?: MiddlewareScope[];
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

  const reason = routesFailed
    ? `routes getter not a literal: ${routesFailed}`
    : mwFailed
      ? `middleware getter not a literal Map: ${mwFailed}`
      : undefined;

  return {
    ok: !reason,
    reason,
    className: cls.id?.name,
    extendsName,
    imports,
    routes,
    middleware,
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
      routes.push(readRouteEntry(method, p, routeProp.value));
    }
  }
  return { ok: true, routes };
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
  // `{ handler: this.x, request?, query? }`
  if (init.type === 'ObjectExpression') {
    let handler: string | null = null;
    let hasRequest = false;
    let hasQuery = false;
    for (const prop of init.properties) {
      if (prop.type !== 'Property') {
        continue;
      }
      const key = propName(prop.key);
      if (key === 'handler' && prop.value.type === 'MemberExpression') {
        handler = prop.value.property?.name ?? null;
      } else if (key === 'request') {
        hasRequest = true; // the VALUE (defineSchema(...)) is never evaluated
      } else if (key === 'query') {
        hasQuery = true;
      }
    }
    return { method, path, handler, hasRequest, hasQuery };
  }
  return { method, path, handler: null, hasRequest: false, hasQuery: false };
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
