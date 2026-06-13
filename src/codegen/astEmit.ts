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

import { type Dirent, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSubtreeFromSpec,
  convertPathSyntax,
} from '../controllers/index.ts';
import { getFilesPathWithInheritance } from '../helpers/files.ts';
import type { IApp } from '../server.ts';
import type { FlatRoute } from '../services/http/routing/RouteNode.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import type { CodegenLogger } from './appTypes.ts';
import type { ExtractCache, ResolvedController } from './astResolve.ts';
import { specFromExtracted } from './astSpec.ts';
import type {
  ControllerMeta,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';
import { renderGenFile } from './emit.ts';

/** A planned gen-file write: its target path and rendered text. */
export interface PlannedOutput {
  outPath: string;
  text: string;
}

/** Result of analyzing (but not writing) the route types. */
export interface RoutePlan {
  /** Gen files to write (user controllers only; framework-internal skipped). */
  outputs: PlannedOutput[];
  /** Controllers that aren't statically analyzable. By default the caller
   * throws; with `skipNonAnalyzable` they're skipped (no types) and listed
   * here so the caller can warn. */
  needsBoot: string[];
  /** Existing `*.routes.gen.ts` in the user folder with no sibling source. */
  orphans: string[];
}

/**
 * Analyze the project's controller sources (no import, no boot) and return the
 * gen files to write — WITHOUT writing anything. Registers all controllers
 * (framework-internal + user) into one registry so cross-controller bleed
 * resolves exactly like runtime, then renders each user controller's gen text.
 *
 * Pure analysis so the caller can fail before any write (atomicity) and so a
 * `--check` run can compare against disk using the exact same rendering path.
 */
export async function planRouteTypes(
  app: IApp,
  logger?: CodegenLogger | null,
  options: { skipNonAnalyzable?: boolean } = {},
): Promise<RoutePlan> {
  const discovered = await discoverControllers(
    app.foldersConfig.controllers,
    logger,
  );
  logger?.info?.(
    `Found ${discovered.length} controller source(s) for route types`,
  );

  // One parse cache for the whole run — shared ancestors parse once.
  const cache: ExtractCache = new Map();
  const resolvedAll = await Promise.all(
    discovered.map(async (d) => ({
      ...d,
      ...(await specFromExtracted(d.srcPath, d.prefix, cache)),
    })),
  );

  const orphans = await findOrphanGenFiles(app.foldersConfig.controllers);

  const needsBoot = resolvedAll
    .filter((r) => r.resolved.needsBoot)
    .map((r) => r.srcPath);
  // Strict default: one non-analyzable controller aborts the whole run (the
  // caller throws). `skipNonAnalyzable` flips this to skip-those-and-continue,
  // emitting types for the rest (used by `generateAll`).
  if (needsBoot.length > 0 && !options.skipNonAnalyzable) {
    logger?.info?.(
      `${needsBoot.length} controller(s) aren't statically analyzable — no route types written (caller will throw)`,
    );
    return { outputs: [], needsBoot, orphans };
  }

  // Analyze only the statically-analyzable controllers (= all of them when none
  // needsBoot). Non-analyzable ones are skipped from BOTH the registry and the
  // outputs, so a skipped controller never contributes — or blocks — types.
  const analyzable = resolvedAll.filter((r) => !r.resolved.needsBoot);

  // One registry resolves cross-controller bleed exactly like runtime. Register
  // BOTH framework-internal and user controllers so bleed/conflict sees the full
  // picture. A per-controller collision pre-check names BOTH offending files —
  // the raw registry error only carries the segment.
  //
  // Note: the runtime sorts `index` controllers first; codegen registers in
  // discovery order. That divergence is harmless — the emitted types are
  // order-insensitive (the middleware chain at each leaf is the same set, and
  // type intersections commute). Do not "fix" the order into a real difference.
  const registry = new RouteRegistry();
  const owner = new Map<string, string>();
  for (const r of analyzable) {
    const check = new RouteRegistry();
    check.registerSubtree(r.resolved.urlPrefix, buildSubtreeFromSpec(r.spec));
    for (const fr of check.flatten()) {
      const key = `${fr.method} ${fr.path}`;
      const prev = owner.get(key);
      if (prev && prev !== r.srcPath) {
        throw new Error(
          `Route-type codegen: conflicting route ${key} is declared by both ${prev} and ${r.srcPath}`,
        );
      }
      owner.set(key, r.srcPath);
    }
    registry.registerSubtree(
      r.resolved.urlPrefix,
      buildSubtreeFromSpec(r.spec),
    );
  }
  const flatByKey = indexFlat(registry.flatten());

  const outputs: PlannedOutput[] = [];
  for (const r of analyzable) {
    // Framework-internal controllers ship pre-generated gen files — registered
    // above for bleed, but never written into the installed package.
    if (r.isInternal) {
      continue;
    }
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
    outputs.push({ outPath, text });
  }
  return { outputs, needsBoot, orphans };
}

/**
 * AST-primary route-type generation: plan, then write each user controller's
 * `<File>.routes.gen.ts` and delete orphaned gen files. If ANY controller isn't
 * statically analyzable nothing is written and the paths are returned so the
 * caller throws and names them. There is no boot fallback.
 */
export async function generateRouteTypesViaAst(
  app: IApp,
  logger?: CodegenLogger | null,
): Promise<{ written: number; needsBoot: string[] }> {
  const plan = await planRouteTypes(app, logger);
  if (plan.needsBoot.length > 0) {
    return { written: 0, needsBoot: plan.needsBoot };
  }
  await writePlanned(plan.outputs, logger);
  await deleteOrphans(plan.orphans, logger);
  logger?.info?.(`Wrote ${plan.outputs.length} route-type file(s) via AST`);
  return { written: plan.outputs.length, needsBoot: [] };
}

/** Write the planned gen files to disk. */
export async function writePlanned(
  outputs: PlannedOutput[],
  logger?: CodegenLogger | null,
): Promise<void> {
  for (const { outPath, text } of outputs) {
    await fs.writeFile(outPath, text, 'utf8');
    logger?.info?.(`  → ${outPath}`);
  }
}

/** Delete orphaned gen files (those with no sibling controller source). */
export async function deleteOrphans(
  orphans: string[],
  logger?: CodegenLogger | null,
): Promise<void> {
  for (const orphan of orphans) {
    await fs.rm(orphan, { force: true });
    logger?.info?.(`  ✗ removed orphan gen file ${orphan}`);
  }
}

/**
 * Find `*.routes.gen.ts` files under `userDir` that have no sibling controller
 * source (`<base>.ts`/`.js`) — left behind when a controller is renamed/deleted,
 * and a `tsc`-breaker for consumers. Scoped to the user folder; never touches the
 * installed framework package.
 */
async function findOrphanGenFiles(userDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(userDir, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.routes.gen.ts')) {
      continue;
    }
    const parent =
      (e as unknown as { parentPath?: string }).parentPath ?? userDir;
    const base = e.name.slice(0, -'.routes.gen.ts'.length);
    const hasSource =
      existsSync(path.join(parent, `${base}.ts`)) ||
      existsSync(path.join(parent, `${base}.js`));
    if (!hasSource) {
      out.push(path.join(parent, e.name));
    }
  }
  return out;
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
  // A `.js` controller has no inferable type unless a sibling `.d.ts` exists, so
  // the gen file can't `import type` it without a `TS7016` in a strict consumer
  // build (no `allowJs`). TS sources are always importable.
  const ctrlExt = path.extname(srcPath);
  const controllerTypeImportable =
    ctrlExt === '.ts' ||
    ctrlExt === '.mts' ||
    ctrlExt === '.cts' ||
    existsSync(
      path.join(
        path.dirname(srcPath),
        `${path.basename(srcPath, ctrlExt)}.d.ts`,
      ),
    );
  return renderGenFile({
    controller,
    srcPath,
    filteredChains,
    importMap,
    controllerTypeImportable,
  });
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

/** The framework's own controllers dir (a sibling of this codegen module). */
function frameworkControllersDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../controllers',
  );
}

function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

interface DiscoveredController {
  srcPath: string;
  /** Folder relative to the controllers root, '' for root-level. */
  prefix: string;
  /** Framework-internal file: register for bleed, but never emit (ships its own). */
  isInternal: boolean;
}

/**
 * Discover controller sources exactly like the runtime loader
 * (`getFilesPathWithInheritance`): merge the framework's internal controllers
 * with the user folder (user filename wins on collision), applying the same
 * capital-first / not-test / not-gen / not-`.d.ts` filter. Each file carries its
 * folder `prefix` (drives the default mount path) and an `isInternal` flag.
 */
async function discoverControllers(
  userDir: string,
  logger?: CodegenLogger | null,
): Promise<DiscoveredController[]> {
  const internalDir = frameworkControllersDir();
  // When codegen runs inside the framework repo itself, the user dir IS the
  // internal dir — there's nothing external to skip, so emit everything.
  const sameTree = path.resolve(internalDir) === path.resolve(userDir);
  const files = await getFilesPathWithInheritance({
    internalFolder: internalDir,
    externalFolder: userDir,
    logger: (m) => logger?.info?.(m),
  });
  return files.map(({ path: srcPath, file }) => {
    const dir = path.dirname(file);
    return {
      srcPath,
      prefix: dir === '.' ? '' : dir,
      isInternal: !sameTree && isUnder(internalDir, srcPath),
    };
  });
}
