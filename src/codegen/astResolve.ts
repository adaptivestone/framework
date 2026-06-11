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

import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defaultControllerHttpPath } from '../modules/AbstractController.ts';
import {
  type ExtractResult,
  extractController,
  type ImportInfo,
  type MiddlewareScope,
  type RouteInfo,
} from './astExtract.ts';
import { relativeImport, resolveRelativeFile } from './paths.ts';

export interface ResolvedImport extends ImportInfo {
  /** The local binding the gen file emits (`import type <binding> from …`). */
  binding: string;
}

/** Per-run cache of parsed sources by absolute path, so a shared ancestor
 * (e.g. `AbstractController`) is read + parsed once per generation run, not once
 * per controller. No mtime/persistence — content is stable within a run. */
export type ExtractCache = Map<string, ExtractResult>;

async function readAndExtract(
  absPath: string,
  cache?: ExtractCache,
): Promise<ExtractResult | null> {
  const cached = cache?.get(absPath);
  if (cached) {
    return cached;
  }
  let source: string;
  try {
    source = await fs.readFile(absPath, 'utf8');
  } catch {
    return null; // source unreachable
  }
  const ex = extractController(source, absPath);
  cache?.set(absPath, ex);
  return ex;
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

/**
 * Resolve a controller's routes + effective middleware + emittable imports.
 * `prefix` is the controller's folder relative to the controllers root (e.g.
 * `admin` for `controllers/admin/Users.ts`); it feeds the default mount path
 * exactly as the runtime loader does, so nested controllers mount correctly.
 */
export async function resolveController(
  srcPath: string,
  prefix = '',
  cache?: ExtractCache,
): Promise<ResolvedController> {
  const childDir = path.dirname(srcPath);
  const source = await fs.readFile(srcPath, 'utf8');
  const self = extractController(source, srcPath);
  cache?.set(srcPath, self);

  // The controller's own routes + needsBoot come from itself. Middleware may be
  // inherited, so it's resolved by walking `extends`.
  const found: Definer | 'dynamic' | Unresolvable | null = self.middleware
    ? { file: srcPath, ex: self, rewriteBase: null }
    : await findMiddlewareDefiner(srcPath, self, cache);
  // A non-literal `static get middleware()` reached UP the chain (the child's own
  // is already covered by `self.ok`): treat it like the child case — not
  // statically analyzable, so the run throws instead of dropping real middleware.
  const ancestorMiddlewareDynamic = found === 'dynamic';
  // An `extends` import that couldn't be followed → unknown inherited middleware.
  const unresolvableAncestor =
    found !== null && found !== 'dynamic' && 'unresolvable' in found
      ? found.unresolvable
      : null;
  const definer: Definer | null =
    found !== null && found !== 'dynamic' && !('unresolvable' in found)
      ? found
      : null;

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

  // A middleware the controller references in its OWN map/routes but doesn't
  // import is either a class declared in this same file — keep it, importing from
  // the controller's own module if exported, fail loud if not — or a genuinely
  // foreign bleed-in, left to the importable filter at emit. (Inherited-map
  // bindings come from the ancestor file, so only the self case is checked.)
  const ownBindings = new Set<string>(routeBindings);
  if (definer?.file === srcPath) {
    for (const b of mapBindings) {
      ownBindings.add(b);
    }
  }
  const unexportedLocalMw: string[] = [];
  for (const binding of ownBindings) {
    if (byBinding.has(binding)) {
      continue; // resolved via an import
    }
    const localExported = self.localClasses[binding];
    if (localExported === undefined) {
      continue; // not declared in this file — foreign/global, handled by the filter
    }
    if (!localExported) {
      unexportedLocalMw.push(binding);
      continue;
    }
    byBinding.set(binding, {
      binding,
      kind: 'named',
      specifier: relativeImport(childDir, srcPath),
    });
  }
  const imports = [...byBinding.values()];

  // `self.ok` is false when routes / own-middleware / getHttpPath weren't
  // literals; that (or no exported class, a dynamic ancestor middleware Map, an
  // unresolvable ancestor import, or a locally-declared-but-unexported
  // middleware) → not statically analyzable (the run throws; the `needsBoot`
  // name is kept for the flag's history).
  const needsBoot =
    !self.ok ||
    !self.className ||
    ancestorMiddlewareDynamic ||
    unresolvableAncestor !== null ||
    unexportedLocalMw.length > 0;
  // An explicit literal `getHttpPath()` wins; otherwise the mount path is the
  // folder prefix + class name, computed identically to the runtime loader.
  const urlPrefix =
    self.httpPath ?? defaultControllerHttpPath(prefix, self.className ?? '');

  return {
    className: self.className,
    urlPrefix,
    routes: self.routes,
    middleware,
    imports,
    needsBoot,
    reason: needsBoot
      ? (self.reason ??
        (ancestorMiddlewareDynamic
          ? "an ancestor's `static get middleware()` is not a literal Map"
          : unresolvableAncestor !== null
            ? `could not resolve the \`extends\` ancestor '${unresolvableAncestor.specifier}' imported by ${unresolvableAncestor.file}`
            : unexportedLocalMw.length > 0
              ? `middleware ${unexportedLocalMw
                  .map((b) => `\`${b}\``)
                  .join(
                    ', ',
                  )} declared in this file but not exported — export it or move it to its own module`
              : 'no exported controller class found'))
      : undefined,
  };
}

// ─── extends-walk ────────────────────────────────────────────────────────────

interface Definer {
  file: string;
  ex: ExtractResult;
  /** Set when reached through a bare-package ancestor: that file's bare subpath. */
  rewriteBase: string | null;
}

/** An `extends` import that exists but couldn't be followed (file missing, bare
 * package unresolvable, source unreadable). Distinct from a genuine chain end —
 * the middleware it would contribute is unknown, so the run must fail loud. */
interface Unresolvable {
  unresolvable: { specifier: string; file: string };
}

/** Walk `extends` from `srcPath` to the nearest ancestor that declares a
 * `static get middleware()`. Returns the `Definer`, `'dynamic'` if an ancestor
 * defines middleware but not as a literal Map, an `Unresolvable` if an ancestor
 * import couldn't be followed, or `null` if the chain genuinely ends with no
 * middleware declared. */
async function findMiddlewareDefiner(
  srcPath: string,
  selfEx: ExtractResult,
  cache?: ExtractCache,
): Promise<Definer | 'dynamic' | Unresolvable | null> {
  const visited = new Set<string>([srcPath]);

  async function visit(
    fromFile: string,
    ex: ExtractResult,
    rewriteBase: string | null,
  ): Promise<Definer | 'dynamic' | Unresolvable | null> {
    // A `static get middleware()` that exists here but isn't a literal Map: the
    // chain stops being analyzable. Distinct from "no getter here" (keep walking)
    // — conflating them would silently drop this ancestor's real middleware.
    if (ex.middlewareDynamic) {
      return 'dynamic';
    }
    if (ex.middleware !== undefined) {
      return { file: fromFile, ex, rewriteBase };
    }
    if (!ex.extendsName) {
      return null; // genuine chain end — no walkable parent
    }
    const spec = ex.imports[ex.extendsName]?.specifier;
    if (!spec) {
      return null; // parent isn't an imported binding (local/global) — can't walk
    }
    const next = resolveAncestor(spec, fromFile, rewriteBase);
    if (!next) {
      // The `extends` import exists but doesn't resolve to a file — fail loud
      // rather than emit an empty chain that drops real inherited middleware.
      return { unresolvable: { specifier: spec, file: fromFile } };
    }
    if (visited.has(next.file)) {
      return null; // cycle stop — a legitimate end, not an unresolved import
    }
    visited.add(next.file);
    const nextEx = await readAndExtract(next.file, cache);
    if (!nextEx) {
      return { unresolvable: { specifier: spec, file: fromFile } };
    }
    return visit(next.file, nextEx, next.rewriteBase);
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
