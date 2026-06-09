/**
 * Codegen extends-walk + inheritance merge (plan:
 * `.plans/refactor/queued/codegen-ast.md` · design: `docs/codegen-ast-approach.md`).
 *
 * Bridges the per-file `astExtract` reader to what the codegen front-end needs:
 * a controller's EFFECTIVE middleware (own map, or — matching JS static-getter
 * inheritance — the nearest ancestor that defines `static get middleware()`) plus
 * an emittable `binding → specifier` import map for those middlewares, resolved
 * across relative AND bare-package ancestors.
 *
 * This replaced `importResolution.ts` (since deleted). The hard part the regex
 * version paid for — recovering a binding from a live class by identity matching,
 * because the registry handed it class objects with no source path — is gone:
 * the binding IS the import-node name, read directly. What remains is pure path
 * math (was shared with the old emit):
 *  - a relative ancestor's middleware imports are rebased to the child gen-file
 *    directory (the gen file sits next to the controller);
 *  - a bare-package ancestor's relative imports are rewritten into bare specifiers
 *    rooted at that ancestor's package subpath (the public subpath tree mirrors
 *    `src/`).
 *
 * When the controller's `routes` getter isn't a literal, `needsBoot` is set; the
 * controller can't be statically analyzed and `generateAll` throws (no fallback).
 */

import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  type ExtractResult,
  extractController,
  type ImportInfo,
  type MiddlewareScope,
  type RouteInfo,
} from './astExtract.ts';

export interface ResolvedImport extends ImportInfo {
  /** The local binding the gen file emits (`import type <binding> from …`). */
  binding: string;
}

export interface ResolvedController {
  className?: string;
  /** Mount path: the literal `getHttpPath()` return, else `/<classname>`. */
  urlPrefix: string;
  routes: RouteInfo[];
  /** Effective middleware (own, or inherited from the nearest defining ancestor). */
  middleware: MiddlewareScope[];
  /** Emittable import for each middleware binding in `middleware`. */
  imports: ResolvedImport[];
  /** True when a getter / `getHttpPath` wasn't a literal — not analyzable (throws). */
  needsBoot: boolean;
  reason?: string;
}

/** Resolve a controller's routes + effective middleware + emittable imports. */
export async function resolveController(
  srcPath: string,
): Promise<ResolvedController> {
  const childDir = path.dirname(srcPath);
  const source = await fs.readFile(srcPath, 'utf8');
  const self = extractController(source, srcPath);

  // The controller's own routes + needsBoot come from itself. Middleware may be
  // inherited, so it's resolved by walking `extends`.
  const definer = self.middleware
    ? { file: srcPath, ex: self, rewriteBase: null as string | null }
    : await findMiddlewareDefiner(srcPath, self);

  const middleware = definer?.ex.middleware ?? [];

  // Emittable imports cover BOTH the effective (Map) middleware — from the
  // defining file (an ancestor, rebased) — and route-level middleware, which is
  // always declared in (and imported by) the controller itself. A binding in
  // both resolves to the controller's own import (child wins), so route-level is
  // merged last.
  const mapBindings = new Set<string>();
  for (const scope of middleware) {
    for (const b of scope.bindings) {
      mapBindings.add(b);
    }
  }
  const routeBindings = new Set<string>();
  for (const r of self.routes) {
    for (const b of r.middleware ?? []) {
      routeBindings.add(b);
    }
  }
  const byBinding = new Map<string, ResolvedImport>();
  if (definer) {
    for (const i of resolveBindingImports(
      mapBindings,
      definer,
      srcPath,
      childDir,
    )) {
      byBinding.set(i.binding, i);
    }
  }
  const selfDefiner: Definer = { file: srcPath, ex: self, rewriteBase: null };
  for (const i of resolveBindingImports(
    routeBindings,
    selfDefiner,
    srcPath,
    childDir,
  )) {
    byBinding.set(i.binding, i);
  }
  const imports = [...byBinding.values()];

  // `self.ok` is false when routes / own-middleware / getHttpPath weren't
  // literals; any of those (or no exported class) → not statically analyzable
  // (the run throws; the `needsBoot` name is kept for the flag's history).
  const needsBoot = !self.ok || !self.className;
  const urlPrefix = self.httpPath ?? `/${(self.className ?? '').toLowerCase()}`;

  return {
    className: self.className,
    urlPrefix,
    routes: self.routes,
    middleware,
    imports,
    needsBoot,
    reason: needsBoot ? self.reason : undefined,
  };
}

// ─── extends-walk ────────────────────────────────────────────────────────────

interface Definer {
  file: string;
  ex: ExtractResult;
  /** Set when reached through a bare-package ancestor: that file's bare subpath. */
  rewriteBase: string | null;
}

/** Walk `extends` from `srcPath` to the nearest ancestor that declares a
 * `static get middleware()`. Returns `null` if none is found. */
async function findMiddlewareDefiner(
  srcPath: string,
  selfEx: ExtractResult,
): Promise<Definer | null> {
  const visited = new Set<string>([srcPath]);

  async function visit(
    fromFile: string,
    ex: ExtractResult,
    rewriteBase: string | null,
  ): Promise<Definer | null> {
    if (ex.middleware !== undefined) {
      return { file: fromFile, ex, rewriteBase };
    }
    if (!ex.extendsName) {
      return null;
    }
    const spec = ex.imports[ex.extendsName]?.specifier;
    if (!spec) {
      return null;
    }
    const next = resolveAncestor(spec, fromFile, rewriteBase);
    if (!next || visited.has(next.file)) {
      return null;
    }
    visited.add(next.file);
    let source: string;
    try {
      source = await fs.readFile(next.file, 'utf8');
    } catch {
      return null; // ancestor source unreachable
    }
    return visit(
      next.file,
      extractController(source, next.file),
      next.rewriteBase,
    );
  }

  return visit(srcPath, selfEx, null);
}

/** Resolve an `extends` specifier to an on-disk source + its bare context. */
function resolveAncestor(
  spec: string,
  fromFile: string,
  rewriteBase: string | null,
): { file: string; rewriteBase: string | null } | null {
  if (spec.startsWith('.')) {
    const file = resolveRelativeFile(path.dirname(fromFile), spec);
    if (!file) {
      return null;
    }
    // A relative parent of a bare-package file stays inside that package — carry
    // the bare context forward, advanced to the parent's subpath.
    return {
      file,
      rewriteBase:
        rewriteBase === null ? null : rewriteRelativeToBare(spec, rewriteBase),
    };
  }
  // Bare specifier → resolve through the importing file (honors `exports`); the
  // resolved file's bare context becomes the specifier itself.
  try {
    return { file: createRequire(fromFile).resolve(spec), rewriteBase: spec };
  } catch {
    return null;
  }
}

// ─── import resolution ───────────────────────────────────────────────────────

/** Build the emittable import for each `binding` declared in `from`'s file. */
function resolveBindingImports(
  bindings: Set<string>,
  from: Definer,
  srcPath: string,
  childDir: string,
): ResolvedImport[] {
  const out: ResolvedImport[] = [];
  for (const binding of bindings) {
    const info = from.ex.imports[binding];
    if (!info) {
      continue; // not imported in that file — dropped (can't emit)
    }
    out.push({
      binding,
      kind: info.kind,
      ...(info.orig ? { orig: info.orig } : {}),
      specifier: emitSpecifier(info.specifier, from, srcPath, childDir),
    });
  }
  return out;
}

/** Transform a defining file's import specifier into the form the child's gen
 * file should emit (resolvable from the gen file's own directory). */
function emitSpecifier(
  spec: string,
  definer: Definer,
  srcPath: string,
  childDir: string,
): string {
  if (!spec.startsWith('.')) {
    return spec; // bare specifier — resolvable from anywhere
  }
  if (definer.rewriteBase !== null) {
    return rewriteRelativeToBare(spec, definer.rewriteBase);
  }
  if (definer.file === srcPath) {
    return spec; // the child's own import — already relative to its gen file
  }
  // Relative ancestor in another directory — rebase to the child gen-file dir.
  return relativeImport(
    childDir,
    path.resolve(path.dirname(definer.file), spec),
  );
}

// ─── path helpers ────────────────────────────────────────────────────────────

/** Probe `.ts` / `.js` / `index.*` for a relative specifier; `null` if none exist. */
function resolveRelativeFile(fromDir: string, spec: string): string | null {
  const stripped = spec.replace(/\.[jt]s$/, '');
  const candidates = [
    ...['.ts', '.js'].map((ext) => path.resolve(fromDir, `${stripped}${ext}`)),
    ...['index.ts', 'index.js'].map((i) => path.resolve(fromDir, stripped, i)),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Rewrite a relative spec into a bare one rooted at `base`'s package subpath
 * (e.g. inside `…/modules/X.js`, `../services/Auth.ts` → `…/services/Auth.js`).
 * The `.ts` source extension is normalized to `.js` (published tree is built). */
function rewriteRelativeToBare(spec: string, base: string): string {
  if (!spec.startsWith('.')) {
    return spec;
  }
  const bare = path.posix.join(path.posix.dirname(base), spec);
  return bare.endsWith('.ts') ? `${bare.slice(0, -3)}.js` : bare;
}

/** A TS-style relative specifier from `fromDir` to `toFile` (forward slashes). */
function relativeImport(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile);
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel.split(path.sep).join('/');
}
