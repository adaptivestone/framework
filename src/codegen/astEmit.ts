/**
 * AST codegen emit (plan: `.plans/refactor/queued/codegen-ast.md`). Produces a
 * controller's `.routes.gen.ts` text WITHOUT booting the app or running
 * `importResolution`: parse → resolve (extends-walk) → build the shared
 * `ControllerSubtreeSpec` → flatten via the real `RouteRegistry` → feed the
 * shared `renderGenFile`. This is the project's sole codegen front-end (the old
 * boot/`importResolution` path was removed once this was proven byte-identical).
 *
 * `generateRouteTypesViaAst` registers ALL controllers into ONE registry (so
 * cross-controller bleed resolves exactly as runtime) and reports any controller
 * whose source isn't statically analyzable (`needsBoot`) so the caller
 * (`generateAll`) throws and names it — there is no boot fallback.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildSubtreeFromSpec,
  convertPathSyntax,
} from '../controllers/index.ts';
import type { IApp } from '../server.ts';
import type { FlatRoute } from '../services/http/routing/RouteNode.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import type { CodegenLogger } from './appTypes.ts';
import type { ResolvedController } from './astResolve.ts';
import { specFromExtracted } from './astSpec.ts';
import type {
  ControllerMeta,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';
import { renderGenFile } from './emit.ts';

export interface AstEmitResult {
  /** The gen.ts text, or `null` when `needsBoot` (not statically analyzable). */
  text: string | null;
  needsBoot: boolean;
  reason?: string;
}

/** Emit one controller's `.routes.gen.ts` via the AST path (single-controller
 * flatten — correct for a controller with no cross-controller bleed). */
export async function emitGenFileViaAst(
  srcPath: string,
): Promise<AstEmitResult> {
  const { spec, resolved } = await specFromExtracted(srcPath);
  if (resolved.needsBoot) {
    return { text: null, needsBoot: true, reason: resolved.reason };
  }
  // Chains at a route are prefix-independent in isolation, so a synthetic prefix
  // is fine — we look it up with the same prefix.
  const urlPrefix = '/__codegen';
  const registry = new RouteRegistry();
  registry.registerSubtree(urlPrefix, buildSubtreeFromSpec(spec));
  const flatByKey = indexFlat(registry.flatten());
  return {
    text: renderResolved(srcPath, resolved, flatByKey, urlPrefix),
    needsBoot: false,
  };
}

/**
 * AST-primary route-type generation: discover the project's controller sources
 * (no import, no boot), register them ALL into one registry (bleed-correct),
 * flatten once, and emit each `<File>.routes.gen.ts` from the shared renderer.
 *
 * If ANY controller isn't statically analyzable (`needsBoot` — a non-literal
 * `routes`/`middleware`/`getHttpPath`), nothing is written and their paths are
 * returned so the caller (`generateAll`) throws and names them. There is no boot
 * fallback — non-declarative controllers are a hard error.
 */
export async function generateRouteTypesViaAst(
  app: IApp,
  logger?: CodegenLogger | null,
): Promise<{ written: number; needsBoot: string[] }> {
  const files = await discoverControllerFiles(app.foldersConfig.controllers);
  logger?.info?.(`Found ${files.length} controller source(s) for route types`);

  const resolvedAll = await Promise.all(
    files.map(async (srcPath) => ({
      srcPath,
      ...(await specFromExtracted(srcPath)),
    })),
  );

  const needsBoot = resolvedAll
    .filter((r) => r.resolved.needsBoot)
    .map((r) => r.srcPath);
  if (needsBoot.length > 0) {
    logger?.info?.(
      `${needsBoot.length} controller(s) aren't statically analyzable — no route types written (caller will throw)`,
    );
    return { written: 0, needsBoot };
  }

  // All declarative → one registry resolves cross-controller bleed like runtime.
  const registry = new RouteRegistry();
  for (const r of resolvedAll) {
    registry.registerSubtree(
      r.resolved.urlPrefix,
      buildSubtreeFromSpec(r.spec),
    );
  }
  const flatByKey = indexFlat(registry.flatten());

  let written = 0;
  for (const r of resolvedAll) {
    const text = renderResolved(
      r.srcPath,
      r.resolved,
      flatByKey,
      r.resolved.urlPrefix,
    );
    const outPath = path.join(
      path.dirname(r.srcPath),
      // Strip whichever source extension (.ts or .js); the gen file is always .ts.
      `${path.basename(r.srcPath, path.extname(r.srcPath))}.routes.gen.ts`,
    );
    await fs.writeFile(outPath, text, 'utf8');
    logger?.info?.(`  → ${outPath}`);
    written++;
  }
  logger?.info?.(`Wrote ${written} route-type file(s) via AST`);
  return { written, needsBoot: [] };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Render a resolved controller's gen text using the chains in `flatByKey`. */
function renderResolved(
  srcPath: string,
  resolved: ResolvedController,
  flatByKey: Map<string, FlatRoute>,
  urlPrefix: string,
): string {
  const routes: RouteMeta[] = resolved.routes.map((r) => ({
    method: r.method,
    path: r.path,
    handlerName: r.handler,
    hasSchema: r.hasRequest,
    hasQuerySchema: r.hasQuery,
    ...(r.requestContentTypes
      ? { requestContentTypes: r.requestContentTypes }
      : {}),
  }));
  const importMap = new Map(
    resolved.imports.map((i) => [i.binding, i.specifier]),
  );
  // Only bindings this controller actually imports are emittable. A middleware
  // that bleeds in from another controller (a root-mounted splat) but isn't in
  // this file's import map is dropped — it can't be referenced by name here, so
  // there's no `import type` to emit for it.
  const importable = new Set(importMap.keys());
  const filteredChains: MiddlewareRef[][] = routes.map((route) =>
    chainAt(
      flatByKey,
      route.method.toUpperCase(),
      joinPath(urlPrefix, convertPathSyntax(route.path)),
      importable,
    ),
  );
  const controller: ControllerMeta = {
    className: resolved.className ?? 'Unknown',
    prefix: '',
    urlPrefix,
    routes,
  };
  return renderGenFile({ controller, srcPath, filteredChains, importMap });
}

/** The deduped, importable middleware chain (binding names) for one flat route. */
function chainAt(
  flatByKey: Map<string, FlatRoute>,
  method: string,
  absPath: string,
  importable: Set<string>,
): MiddlewareRef[] {
  const fr = flatByKey.get(`${method} ${absPath}`);
  if (!fr) {
    return [];
  }
  const seen = new Set<string>();
  const out: MiddlewareRef[] = [];
  for (const entry of fr.middlewares) {
    const name = entry.Class.name;
    if (importable.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push({ className: name });
    }
  }
  return out;
}

function indexFlat(flat: FlatRoute[]): Map<string, FlatRoute> {
  const out = new Map<string, FlatRoute>();
  for (const fr of flat) {
    out.set(`${fr.method} ${fr.path}`, fr);
  }
  return out;
}

/** Join a controller's URL prefix with a route sub-path the way the registry
 * builds flat-route paths (segment join, no trailing slash). */
function joinPath(prefix: string, sub: string): string {
  const segments = [...prefix.split('/'), ...sub.split('/')].filter(
    (s) => s.length > 0,
  );
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Controller source files in `dir`: `.ts`, capitalized, not a test or gen file. */
async function discoverControllerFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) {
      continue;
    }
    const base = e.name;
    // Mirror the runtime controller loader (`helpers/files.ts`): it loads `.ts`
    // AND `.js` controllers and skips `.d.ts` / `.gen.*` / `.test.*`. Missing
    // `.d.ts` here lets a colocated declaration file (e.g. `Foo.d.ts`,
    // `Foo.gen.d.ts`) reach the extractor, which finds no class → `needsBoot` →
    // the whole run throws; missing `.js` would leave a runtime-loaded
    // controller untyped AND absent from the shared bleed registry.
    if (
      !/^[A-Z]/.test(base) ||
      !(base.endsWith('.ts') || base.endsWith('.js')) ||
      base.endsWith('.d.ts') ||
      base.endsWith('.gen.ts') ||
      base.endsWith('.gen.js') ||
      base.includes('.test.')
    ) {
      continue;
    }
    const parent =
      (e as unknown as { parentPath?: string; path?: string }).parentPath ??
      (e as unknown as { path?: string }).path ??
      dir;
    out.push(path.join(parent, base));
  }
  return out;
}
