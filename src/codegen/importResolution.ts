/**
 * Resolve, for each middleware in a route's chain, the local import binding and
 * specifier the generated `.routes.gen.ts` file should use — so `emit` can write
 * `import type <binding> from '<specifier>'` + `typeof <binding>`.
 *
 * This is the codegen's heaviest piece, and it exists for one reason: the route
 * chain comes from the runtime registry as live CLASS objects, and a JS class
 * carries no source path. So we reconstruct the path/binding from the
 * controller's source — walking the `extends` chain (relative AND bare-package
 * ancestors), rebasing relative imports to the gen file's directory, and
 * identity-matching the live class against the imported modules to recover the
 * binding (the class name may differ from the import name).
 */

import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MiddlewareRef } from './collectMetadata.ts';

export type ModuleNamespace = Record<string, unknown>;

/**
 * Resolve the local import binding a controller uses for a middleware in its
 * chain, or `null` when the middleware is imported nowhere in the extends
 * chain (so it should be dropped from the emitted type).
 *
 * We identity-match the live class against the imported modules so a binding
 * whose name merely collides with the class name (a different class imported
 * under that name) can't win — `import Auth from '.../Auth.js'` where the class
 * is `AuthMiddleware` is resolved to `Auth`, and an unrelated `AuthMiddleware`
 * import is rejected. The class's own name is probed first (the binding in the
 * common case); modules are already loaded, so these dynamic imports hit the
 * cache. Synthetic refs (no live class, e.g. unit tests) fall back to matching
 * the import map by name.
 */
export async function resolveBinding(
  mw: MiddlewareRef,
  importMap: Map<string, string>,
  ctrlDir: string,
  moduleCache: Map<string, ModuleNamespace | null>,
  bindingCache: Map<unknown, string | null>,
): Promise<string | null> {
  if (!mw.Class) {
    return importMap.has(mw.className) ? mw.className : null;
  }
  if (bindingCache.has(mw.Class)) {
    return bindingCache.get(mw.Class) ?? null;
  }
  // Probe the class's own name first, then scan the rest.
  const names = importMap.has(mw.className)
    ? [mw.className, ...importMap.keys()]
    : [...importMap.keys()];
  let binding: string | null = null;
  for (const name of names) {
    const spec = importMap.get(name);
    if (spec === undefined) {
      continue;
    }
    const mod = await importSpec(spec, ctrlDir, moduleCache);
    if (mod && (mod.default === mw.Class || mod[name] === mw.Class)) {
      binding = name;
      break;
    }
  }
  bindingCache.set(mw.Class, binding);
  return binding;
}

/**
 * Import a controller's import specifier for identity matching, tolerating the
 * `.js` ↔ `.ts` extension mismatch the framework uses (source is `.ts`,
 * specifiers may be `.js`). Bare specifiers are resolved from the controller's
 * OWN location (its `node_modules` + the package `exports` map) rather than
 * emit.ts's, so the resolved module is the same copy the controller's chain
 * classes came from — otherwise a duplicate install would fail identity match.
 * Returns `null` if nothing resolves. Results are cached per specifier;
 * failures are cached too.
 */
async function importSpec(
  spec: string,
  ctrlDir: string,
  cache: Map<string, ModuleNamespace | null>,
): Promise<ModuleNamespace | null> {
  const cached = cache.get(spec);
  if (cached !== undefined) {
    return cached;
  }
  const candidates: string[] = [];
  if (spec.startsWith('.')) {
    const abs = path.resolve(ctrlDir, spec);
    candidates.push(pathToFileURL(abs).href);
    const swapped = abs.endsWith('.js')
      ? `${abs.slice(0, -3)}.ts`
      : abs.endsWith('.ts')
        ? `${abs.slice(0, -3)}.js`
        : null;
    if (swapped) {
      candidates.push(pathToFileURL(swapped).href);
    }
  } else {
    // `createRequire` anchored in the controller's directory honors that
    // location's resolution (the filename need not exist — only its dir is used).
    try {
      const req = createRequire(path.join(ctrlDir, 'noop.js'));
      candidates.push(pathToFileURL(req.resolve(spec)).href);
    } catch {
      // not resolvable from the controller — fall back to process resolution
    }
    candidates.push(spec);
    if (spec.endsWith('.js')) {
      candidates.push(`${spec.slice(0, -3)}.ts`);
    }
  }
  let mod: ModuleNamespace | null = null;
  for (const candidate of candidates) {
    try {
      mod = (await import(candidate)) as ModuleNamespace;
      break;
    } catch {
      // try next candidate
    }
  }
  cache.set(spec, mod);
  return mod;
}

/**
 * Build an import map covering the controller and its `extends` ancestors.
 *
 * Inherited `static get middleware()` from a parent class references
 * middleware classes the parent imports — the child file doesn't import
 * them. To emit `import type` lines for them, we walk the extends chain,
 * scan each ancestor's source file for its imports, and merge.
 *
 * Resolution rules:
 *  - Child's imports win on name collisions (matches JS class-override
 *    semantics).
 *  - Relative ancestors are read from their sibling source on disk; their
 *    relative imports are rebased to the child gen file's directory.
 *  - Bare-package ancestors (e.g. a consumer extending the framework's
 *    `AbstractController` via `@adaptivestone/framework/modules/...`) are
 *    resolved through the importing file's `require.resolve` (honoring the
 *    package's `exports` map), then their RELATIVE middleware imports are
 *    rewritten into bare specifiers rooted at the same package subpath —
 *    valid because the public subpath tree mirrors `src/`. This is what lets
 *    a consumer relying on inherited default middleware get the right import
 *    lines without re-importing those classes itself.
 */
export async function buildExtendsImportMap(
  srcPath: string,
  source: string,
): Promise<Map<string, string>> {
  const merged = new Map<string, string>();
  const visited = new Set<string>();
  // Every emitted import must resolve from the child's gen file, which sits
  // next to `srcPath`. An ancestor's relative imports are relative to the
  // ancestor's own location, so they get rebased here (see `resolveImportSpec`).
  const childDir = path.dirname(srcPath);

  // `rewriteBase` is set when the file was reached through a bare-package
  // ancestor: it's the bare subpath of that file, used to rewrite the file's
  // relative imports into bare specifiers the consumer's gen file can resolve.
  async function visit(
    filePath: string,
    fileSource: string,
    rewriteBase: string | null,
  ): Promise<void> {
    if (visited.has(filePath)) {
      return;
    }
    visited.add(filePath);

    const localImports = parseImports(fileSource);
    // Merge with "deepest ancestor first" → child wins by being applied last.
    // We descend first, then set our own imports after, so we always overwrite
    // ancestor entries with our own. Achieved by visiting parent before
    // setting our imports.
    const parentName = parseExtendsParent(fileSource);
    const parentImportPath = parentName
      ? localImports.get(parentName)
      : undefined;
    if (parentImportPath) {
      const resolved = resolveAncestorSource(
        filePath,
        parentImportPath,
        rewriteBase,
      );
      if (resolved) {
        try {
          const parentSource = await fs.readFile(resolved.srcPath, 'utf8');
          await visit(resolved.srcPath, parentSource, resolved.rewriteBase);
        } catch {
          // Parent source unreachable — skip silently. The child's own
          // imports still apply.
        }
      }
    }
    // Apply this level's imports AFTER ancestors so we overwrite collisions.
    const fromDir = filePath === srcPath ? null : path.dirname(filePath);
    for (const [name, importPath] of localImports) {
      merged.set(
        name,
        resolveImportSpec(importPath, { rewriteBase, fromDir, childDir }),
      );
    }
  }

  await visit(srcPath, source, null);
  return merged;
}

/**
 * Resolve a controller's `extends` parent import to a readable source path.
 * `rewriteBase` is the current file's bare context (null in the source tree,
 * a bare subpath inside a node_modules package). Cases:
 *  - relative specifier with an existing sibling → that file. The bare context
 *    carries forward: a relative parent of a bare-package file is still inside
 *    that package, so `rewriteBase` is advanced to the parent's subpath.
 *  - bare specifier → resolved through the importing file's `require.resolve`
 *    (honors package `exports`); `rewriteBase` becomes that bare subpath.
 * Returns `null` when nothing resolves.
 */
function resolveAncestorSource(
  fromFile: string,
  importPath: string,
  rewriteBase: string | null,
): { srcPath: string; rewriteBase: string | null } | null {
  const sibling = resolveSiblingSource(fromFile, importPath);
  if (sibling !== null) {
    return {
      srcPath: sibling,
      rewriteBase:
        rewriteBase === null
          ? null
          : rewriteRelativeToBare(importPath, rewriteBase),
    };
  }
  if (importPath.startsWith('.')) {
    return null; // relative, but no source file exists on disk
  }
  try {
    const resolved = createRequire(fromFile).resolve(importPath);
    return { srcPath: resolved, rewriteBase: importPath };
  } catch {
    return null;
  }
}

/**
 * Resolve one of a visited file's import specifiers to the form the child's gen
 * file should emit — so it resolves from the gen file's own directory:
 *  - bare specifier → emitted as-is (resolvable from anywhere via node_modules).
 *  - relative import in a bare-package ancestor (`rewriteBase` set) → rewritten
 *    to a bare specifier (see `rewriteRelativeToBare`).
 *  - relative import in the child itself (`fromDir === null`) → kept as-is; it's
 *    already relative to the gen file.
 *  - relative import in a relative ancestor → rebased from the ancestor's
 *    directory to the child's, so a controller inheriting middleware from a
 *    parent in another folder still emits a path that resolves.
 */
function resolveImportSpec(
  spec: string,
  opts: {
    rewriteBase: string | null;
    fromDir: string | null;
    childDir: string;
  },
): string {
  if (!spec.startsWith('.')) {
    return spec;
  }
  if (opts.rewriteBase !== null) {
    return rewriteRelativeToBare(spec, opts.rewriteBase);
  }
  if (opts.fromDir === null) {
    return spec;
  }
  return relativeImport(opts.childDir, path.resolve(opts.fromDir, spec));
}

/**
 * Rewrite a relative import specifier into a bare one rooted at `base`'s
 * package subpath (e.g. inside `@adaptivestone/framework/modules/X.js`, the
 * relative `../services/.../Auth.ts` becomes
 * `@adaptivestone/framework/services/.../Auth.js`). The `.ts` source extension
 * is normalized to `.js` so the spec resolves through the package's published
 * `exports` (which map to the built `.js` tree). No-op when `base` is null
 * (relative-ancestor case) or the spec is already bare.
 */
function rewriteRelativeToBare(spec: string, base: string | null): string {
  if (base === null || !spec.startsWith('.')) {
    return spec;
  }
  const bare = path.posix.join(path.posix.dirname(base), spec);
  return bare.endsWith('.ts') ? `${bare.slice(0, -3)}.js` : bare;
}

/** `class X extends Y {` → `'Y'`. Returns `null` if no extends clause. */
function parseExtendsParent(source: string): string | null {
  const m = source.match(/\bclass\s+\w+\s+extends\s+(\w+)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Given an import path used by `fromFile`, resolve it to an absolute source
 * path that EXISTS. Returns `null` for bare-package specifiers and for paths
 * whose target isn't found. The existence check matters: a relative ancestor in
 * source is `.ts`, but the same import inside a bare package (node_modules) is
 * the built `.js` — without checking, a non-existent `.ts` would shadow the real
 * `.js` and the ancestor's middleware would be silently dropped.
 */
function resolveSiblingSource(
  fromFile: string,
  importPath: string,
): string | null {
  if (!importPath.startsWith('.')) {
    return null; // bare package, resolved elsewhere
  }
  const fromDir = path.dirname(fromFile);
  // Strip the `.js`/`.ts` extension, then probe whichever exists — source is
  // `.ts`, but the same import inside a bare package (node_modules) is the
  // built `.js`.
  const stripped = importPath.replace(/\.[jt]s$/, '');
  for (const ext of ['.ts', '.js']) {
    const candidate = path.resolve(fromDir, `${stripped}${ext}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Parse top-of-file `import` declarations into a binding-name → path map.
 * Handles default imports (`import X from '…'`), namespace-style default
 * (`import * as X from '…'`), and named imports (`import { A, B as C }
 * from '…'`). Strips `import type` and `as Alias` rebinding.
 */
function parseImports(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\*\s+as\s+(\w+)\s+)?(?:\{([^}]+)\}\s+)?from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while (true) {
    m = re.exec(source);
    if (m === null) {
      break;
    }
    const [, defaultName, starName, namedBlock, importPath] = m;
    if (defaultName) {
      map.set(defaultName, importPath ?? '');
    }
    if (starName) {
      map.set(starName, importPath ?? '');
    }
    if (namedBlock) {
      for (const piece of namedBlock.split(',')) {
        const trimmed = piece.trim();
        if (!trimmed) {
          continue;
        }
        // `OrigName as LocalName` → bind LocalName
        const asMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
        const localName = asMatch
          ? asMatch[2]
          : trimmed.replace(/^type\s+/, '').trim();
        if (localName) {
          map.set(localName, importPath ?? '');
        }
      }
    }
  }
  return map;
}

/** Compute a TS-style relative import specifier from `fromDir` to `toFile`. */
export function relativeImport(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile);
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  // Ensure forward slashes (cross-platform)
  return rel.split(path.sep).join('/');
}
