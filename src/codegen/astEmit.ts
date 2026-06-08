/**
 * AST codegen emit (plan: `.plans/refactor/queued/codegen-ast.md`). Produces a
 * controller's `.routes.gen.ts` text WITHOUT booting the app or running
 * `importResolution`: parse → resolve (extends-walk) → build the shared
 * `ControllerSubtreeSpec` → flatten via the real `RouteRegistry` → feed the
 * SHARED `renderGenFile`. Given the same resolved chains + import map, the output
 * is byte-identical to the boot path (`emitGenFile`) — proven by the differential
 * test. Controllers whose `routes` getter isn't a literal report `needsBoot` so
 * the caller falls back to the boot path for that one.
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
import { specFromExtracted } from './astSpec.ts';
import type {
  ControllerMeta,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';
import { renderGenFile } from './emit.ts';

export interface AstEmitResult {
  /** The gen.ts text, or `null` when `needsBoot` (caller falls back to boot). */
  text: string | null;
  needsBoot: boolean;
  reason?: string;
}

/** Emit one controller's `.routes.gen.ts` via the AST path. */
export async function emitGenFileViaAst(
  srcPath: string,
): Promise<AstEmitResult> {
  const { spec, resolved } = await specFromExtracted(srcPath);
  if (resolved.needsBoot) {
    return { text: null, needsBoot: true, reason: resolved.reason };
  }

  // Flatten this controller alone through the REAL registry. The chain at a
  // route is prefix-independent (it's the middleware scoped to it), so a
  // synthetic prefix is fine — we look it up with the same prefix.
  const urlPrefix = '/__codegen';
  const registry = new RouteRegistry();
  registry.registerSubtree(urlPrefix, buildSubtreeFromSpec(spec));
  const flatByKey = new Map<string, FlatRoute>();
  for (const fr of registry.flatten()) {
    flatByKey.set(`${fr.method} ${fr.path}`, fr);
  }

  const routes: RouteMeta[] = resolved.routes.map((r) => ({
    method: r.method,
    path: r.path,
    handlerName: r.handler,
    hasSchema: r.hasRequest,
    hasQuerySchema: r.hasQuery,
  }));

  const filteredChains: MiddlewareRef[][] = routes.map((route) => {
    const absPath = joinPath(urlPrefix, convertPathSyntax(route.path));
    const fr = flatByKey.get(`${route.method.toUpperCase()} ${absPath}`);
    if (!fr) {
      return [];
    }
    // Dedup by binding name (mirrors the boot `chainFor`).
    const seen = new Set<string>();
    const out: MiddlewareRef[] = [];
    for (const entry of fr.middlewares) {
      const name = entry.Class.name;
      if (!seen.has(name)) {
        seen.add(name);
        out.push({ className: name });
      }
    }
    return out;
  });

  const controller: ControllerMeta = {
    className: resolved.className ?? 'Unknown',
    prefix: '',
    urlPrefix,
    routes,
  };
  const importMap = new Map(
    resolved.imports.map((i) => [i.binding, i.specifier]),
  );

  return {
    text: renderGenFile({ controller, srcPath, filteredChains, importMap }),
    needsBoot: false,
  };
}

/** Join a controller's URL prefix with a route sub-path the way the registry
 * builds flat-route paths (segment join, no trailing slash). Mirrors
 * `routeTypes.joinPath`. */
function joinPath(prefix: string, sub: string): string {
  const segments = [...prefix.split('/'), ...sub.split('/')].filter(
    (s) => s.length > 0,
  );
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * AST-primary route-type generation: discover the project's controller sources
 * (no import, no boot), emit each `<File>.routes.gen.ts` from the parsed AST, and
 * report any controller whose `routes` getter isn't a literal (`needsBoot`) so a
 * caller can fall back to the boot path for those.
 *
 * Scope note (v5): single-controller flatten — correct unless a controller
 * root-mounts (`/`) splat middleware that bleeds into siblings (the multi-
 * controller registry handles that; deferred). The framework's own controllers
 * and typical consumer projects don't bleed.
 */
export async function generateRouteTypesViaAst(
  app: IApp,
  logger?: CodegenLogger | null,
): Promise<{ written: number; needsBoot: string[] }> {
  const dir = app.foldersConfig.controllers;
  const files = await discoverControllerFiles(dir);
  logger?.info?.(`Found ${files.length} controller source(s) for route types`);

  let written = 0;
  const needsBoot: string[] = [];
  for (const srcPath of files) {
    const result = await emitGenFileViaAst(srcPath);
    if (result.needsBoot || result.text === null) {
      needsBoot.push(srcPath);
      logger?.info?.(
        `  ${path.basename(srcPath)}: needs boot fallback (${result.reason ?? 'non-literal routes'})`,
      );
      continue;
    }
    const outPath = path.join(
      path.dirname(srcPath),
      `${path.basename(srcPath, '.ts')}.routes.gen.ts`,
    );
    await fs.writeFile(outPath, result.text, 'utf8');
    logger?.info?.(`  → ${outPath}`);
    written++;
  }
  logger?.info?.(`Wrote ${written} route-type file(s) via AST`);
  return { written, needsBoot };
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
    if (
      !/^[A-Z]/.test(base) ||
      !base.endsWith('.ts') ||
      base.endsWith('.gen.ts') ||
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
