/**
 * Per-controller route type generation. Boots the framework into an
 * inspectable state, registers controllers with a fresh `RouteRegistry`,
 * then walks `registry.flatten()` so the resolved middleware chain
 * matches what the runtime actually executes (no parallel matcher).
 *
 * Emits `<File>.routes.gen.ts` next to each controller. Output is piped
 * through biome at the end so re-runs don't churn whitespace.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import ControllerManager from '../controllers/index.ts';
import type { IApp } from '../server.ts';
import type { FlatRoute } from '../services/http/routing/RouteNode.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import type { CodegenLogger } from './appTypes.ts';
import type {
  ControllerMeta,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';
import { extractControllerMeta } from './collectMetadata.ts';
import { emitGenFile } from './emit.ts';
import { ghostController } from './ghostController.ts';

/** Generate per-controller `.routes.gen.ts` files. */
export async function generateRouteTypes(
  app: IApp,
  logger?: CodegenLogger | null,
): Promise<void> {
  // Codegen runs without a real HTTP server. Stub `app.httpServer` with
  // just the registry — that's the only field `ControllerManager` reads.
  const registry = new RouteRegistry();
  app.httpServer = {
    routeRegistry: registry,
    // biome-ignore lint/suspicious/noExplicitAny: codegen-only fake; real HttpServer has more surface
  } as any;

  const cm = new ControllerManager(app);
  // Codegen drives its own load->register loop: discover classes (no `new`),
  // read each via a constructor-less ghost (codegen layer), and register the
  // ghost instance. `skipWrap: true` skips wrapping handlers with validation
  // (no middleware instantiation). The runtime path is untouched.
  const classes = await cm.loadControllerClasses();
  for (const { ControllerClass, prefix } of classes) {
    const ghost = ghostController(ControllerClass, app, prefix);
    cm.registerControllerInstance(ghost, prefix, { skipWrap: true });
  }
  const flatByKey = indexFlatRoutes(registry.flatten());

  const controllers = Object.values(cm.controllers);
  logger?.info?.(`Found ${controllers.length} controller(s) for route types`);

  let written = 0;
  for (const controller of controllers) {
    const meta = extractControllerMeta(controller);
    const srcPath = await resolveControllerSourcePath(app, meta);
    if (!srcPath) {
      logger?.info?.(
        `Skipping ${meta.className}: no .ts source found in controllers folder.`,
      );
      continue;
    }
    const chains = meta.routes.map((route) =>
      chainFor(route, meta.urlPrefix, flatByKey),
    );
    const outPath = path.join(
      path.dirname(srcPath),
      `${path.basename(srcPath, '.ts')}.routes.gen.ts`,
    );
    const text = await emitGenFile({ controller: meta, srcPath, chains });
    await fs.writeFile(outPath, text, 'utf8');
    logger?.info?.(`  → ${outPath}`);
    written++;
  }

  logger?.info?.(`Wrote ${written} route-type file(s)`);
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Index flat routes by `"<METHOD> <absolute-path>"` for cheap lookup
 * during per-controller chain resolution.
 */
function indexFlatRoutes(flat: FlatRoute[]): Map<string, FlatRoute> {
  const out = new Map<string, FlatRoute>();
  for (const fr of flat) {
    out.set(`${fr.method} ${fr.path}`, fr);
  }
  return out;
}

/**
 * Look up the resolved middleware chain for one route, converting from the
 * registry's `MiddlewareEntry` form to codegen's `MiddlewareRef`. Path
 * syntax conversion: authoring `{*splat}` → internal `*splat` (matches
 * what `ControllerManager` does at boot). Deduplicates by class name —
 * `UnionAppInfoProvides` intersects shapes, so listing the same middleware
 * twice produces the same type but uglier output (this happens when one
 * controller mounts at `/` with a splat-scoped middleware, which then
 * appears in every other controller's chain via the registry root).
 */
function chainFor(
  route: RouteMeta,
  urlPrefix: string,
  flatByKey: Map<string, FlatRoute>,
): MiddlewareRef[] {
  const internalPath = route.path.replace(
    /\{\*([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
    '*$1',
  );
  const absPath = joinPath(urlPrefix, internalPath);
  const fr = flatByKey.get(`${route.method.toUpperCase()} ${absPath}`);
  if (!fr) {
    return [];
  }
  const seen = new Set<string>();
  const out: MiddlewareRef[] = [];
  for (const entry of fr.middlewares) {
    const name = entry.Class.name;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push({
      className: name,
      ...(entry.params !== undefined ? { params: entry.params } : {}),
    });
  }
  return out;
}

function joinPath(prefix: string, sub: string): string {
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const s = sub.startsWith('/') ? sub : `/${sub}`;
  const joined = `${p}${s}`;
  return joined === '' ? '/' : joined;
}

/**
 * Find a controller's source file by convention:
 * `<controllers>/<prefix>/<ClassName>.ts`. Tries class-name-case and
 * lowercase variants. Returns `null` when no `.ts` source exists in the
 * project's controllers folder — covers both legacy `.js` controllers
 * and controllers loaded from external packages (e.g. the framework's
 * own `Home.ts` shipped via `node_modules`).
 */
async function resolveControllerSourcePath(
  app: IApp,
  meta: ControllerMeta,
): Promise<string | null> {
  const controllersDir = app.foldersConfig.controllers;
  const dir = meta.prefix
    ? path.join(controllersDir, meta.prefix)
    : controllersDir;
  const candidates = [
    `${meta.className}.ts`,
    `${meta.className.toLowerCase()}.ts`,
  ];
  for (const c of candidates) {
    const full = path.join(dir, c);
    try {
      await fs.access(full);
      return full;
    } catch {
      // try next
    }
  }
  return null;
}
