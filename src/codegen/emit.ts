/**
 * Render one controller's metadata + resolved middleware chains into
 * `<File>.routes.gen.ts` text. The output matches the hand-written format
 * shipped in step 1.5 — same import shape, same per-handler `<Method>Request`
 * aliases, same `InstanceType<typeof Controller>['routes']` navigation pattern.
 *
 * Import paths for middleware classes are reused verbatim from the controller's
 * own source file. The gen file lives in the same directory as the controller,
 * so relative paths to siblings (other middleware files, etc.) work without
 * recomputation. Framework types (`BaseRequestContext`, `StandardSchemaV1`)
 * are computed relative to the controller's location.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ControllerMeta,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';

/**
 * Inputs the emit step needs that aren't in the metadata itself.
 *
 * `chains` is parallel to `controller.routes`: chains[i] is the resolved
 * middleware list for routes[i], pre-computed by the caller via
 * `RouteRegistry.flatten()` (single source of truth shared with runtime).
 */
export interface EmitInput {
  controller: ControllerMeta;
  /** Absolute path to the controller's source `.ts` file. */
  srcPath: string;
  /** Resolved middleware chains, parallel to `controller.routes`. */
  chains: MiddlewareRef[][];
}

/** Emit the gen.ts text for one controller. */
export async function emitGenFile(input: EmitInput): Promise<string> {
  const { controller, srcPath, chains } = input;
  const source = await fs.readFile(srcPath, 'utf8');
  // Walk the `extends` chain — child controllers inheriting `static get
  // middleware()` from a parent don't import those middleware classes
  // themselves, but their parent does. We need the parent's import paths
  // to emit `import type` lines in the child's gen file. Child imports
  // win on collisions.
  const importMap = await buildExtendsImportMap(srcPath, source);

  // Drop chain entries whose middleware isn't in any ancestor's imports.
  // Cross-controller propagation (a `/`-mounted controller pushing its
  // `'/{*splat}'` middleware onto every other controller's chain) still
  // gets filtered correctly — the receiving controller and its ancestors
  // don't import the propagating middleware.
  const filteredChains = chains.map((chain) =>
    chain.filter((mw) => importMap.has(mw.className)),
  );
  const uniqueMiddlewares = collectUniqueMiddlewares(filteredChains);

  const frameworkRoot = findFrameworkSrcRoot(srcPath);
  const ctrlDir = path.dirname(srcPath);
  const isFrameworkOwnController = srcPath.startsWith(
    `${frameworkRoot}${path.sep}`,
  );
  const relFromCtrl = (target: string) => relativeImport(ctrlDir, target);

  // Framework's own controllers (during framework dev / build) use
  // relative imports because the framework references itself by relative
  // path. External consumers' controllers use bare package specifiers
  // so the gen file resolves through node_modules (or npm-linked
  // framework) regardless of where in the consumer's tree it lives.
  const typesPath = isFrameworkOwnController
    ? relFromCtrl(path.join(frameworkRoot, 'services/http/types.ts'))
    : '@adaptivestone/framework/services/http/types.js';
  const validateTypesPath = isFrameworkOwnController
    ? relFromCtrl(path.join(frameworkRoot, 'services/validate/types.ts'))
    : '@adaptivestone/framework/services/validate/types.js';
  const ctrlBaseName = path.basename(srcPath, '.ts');
  const ctrlImportPath = `./${ctrlBaseName}.ts`;

  const middlewareImports = uniqueMiddlewares
    .map((mw) => `import type ${mw} from '${importMap.get(mw)}';`)
    .sort();

  const routesAlias = `${controller.className}Routes`;
  const anyRouteHasSchema = controller.routes.some(
    (r) => r.hasSchema || r.hasQuerySchema,
  );

  // Group routes by handler name so a method serving multiple routes
  // (e.g., both POST and GET wired to the same `getContainers`) emits
  // a single union alias instead of duplicate identifiers.
  const groupedByHandler = new Map<
    string,
    { route: RouteMeta; chain: MiddlewareRef[] }[]
  >();
  for (let i = 0; i < controller.routes.length; i++) {
    const route = controller.routes[i];
    if (!route?.handlerName) {
      continue;
    }
    const existing = groupedByHandler.get(route.handlerName);
    const entry = { route, chain: filteredChains[i] ?? [] };
    if (existing) {
      existing.push(entry);
    } else {
      groupedByHandler.set(route.handlerName, [entry]);
    }
  }

  const handlerBlocks: string[] = [];
  for (const [, group] of groupedByHandler) {
    const block = renderHandlerGroup(group, routesAlias);
    if (block !== null) {
      handlerBlocks.push(block);
    }
  }

  const importLines: string[] = [];
  importLines.push(...middlewareImports);
  importLines.push(
    `import type {`,
    `  BaseRequestContext,`,
    `  UnionAppInfoProvides,`,
    `} from '${typesPath}';`,
  );
  if (anyRouteHasSchema) {
    importLines.push(
      `import type { StandardSchemaV1 } from '${validateTypesPath}';`,
    );
    importLines.push(
      `import type ${controller.className} from '${ctrlImportPath}';`,
    );
  }
  const importBlock = importLines.join('\n');

  const routesAliasBlock = anyRouteHasSchema
    ? `\n/**\n * Type-level navigation into the controller's \`routes\` getter. Schema\n * references for inline schemas resolve through this alias.\n */\ntype ${routesAlias} = InstanceType<typeof ${controller.className}>['routes'];\n`
    : '';

  const header = `/**
 * AUTOGENERATED — do not edit by hand.
 *
 * Regenerate with: \`npm run gen\`
 *
 * Source of truth: \`${ctrlBaseName}.ts\`'s \`routes\` getter and
 * \`static get middleware()\` Map.
 */
`;

  return `${header}\n${importBlock}\n${routesAliasBlock}\n${handlerBlocks.join('\n\n')}\n`;
}

/**
 * Build the `<MethodName>Request` alias for a group of routes sharing
 * the same handler method. When the group has one route, emits a single
 * shape. When the group has 2+ routes (one method, multiple verbs/paths),
 * emits a union — narrow with `req.method` inside the handler.
 *
 * Output is intentionally single-line for the union/schema generics —
 * gen files are gitignored, so biome skips them (`vcs.useIgnoreFile`),
 * and TS doesn't care about line length. No formatter post-step needed.
 */
function renderHandlerGroup(
  group: { route: RouteMeta; chain: MiddlewareRef[] }[],
  routesAlias: string,
): string | null {
  if (group.length === 0 || !group[0]?.route.handlerName) {
    return null;
  }
  const handlerName = group[0].route.handlerName;
  const typeName = `${pascalCase(handlerName)}Request`;

  const docComment = group
    .map(({ route }) => `\`${route.method.toUpperCase()} ${route.path}\``)
    .join(', ');
  // Dedup identical shapes (same chain + same schemas + same path params)
  // so multi-route handlers with structurally-equivalent contexts emit one
  // shape instead of an N-way union of identical branches.
  const allShapes = group.map(({ route, chain }) =>
    renderShape(route, chain, routesAlias),
  );
  const shapes = Array.from(new Set(allShapes));

  if (shapes.length === 1) {
    return `/** Request type for ${docComment} (handler: \`${handlerName}\`). */
export type ${typeName} = ${shapes[0]};`;
  }
  return `/** Request type for ${docComment} (handler: \`${handlerName}\`). */
export type ${typeName} =
  | ${shapes.join('\n  | ')};`;
}

/** Render the BaseRequestContext intersection for one route. */
function renderShape(
  route: RouteMeta,
  chain: MiddlewareRef[],
  routesAlias: string,
): string {
  const tupleInner =
    chain.length === 0
      ? 'readonly []'
      : `readonly [${chain.map((m) => `typeof ${m.className}`).join(', ')}]`;

  // Path params: `:name` → `name: string`. Splats (`{*name}` user-facing,
  // `*name` internal) capture multiple segments joined with `/` — still a
  // string, not an array (see `match.ts`).
  const pathParams = parsePathParams(route.path);
  const paramsOverride =
    pathParams.length > 0
      ? ` & { params: { ${pathParams.map((p) => `${p}: string`).join('; ')} } }`
      : '';

  // appInfo overrides for body/query when their schema is declared inline
  // on the route entry.
  const appInfoOverrides: string[] = [];
  if (route.hasSchema) {
    if (route.requestContentTypes?.length) {
      // Content-type map → discriminated union keyed by `contentType`. Each
      // branch reads InferOutput of that media type's schema.
      const base = `${routesAlias}['${route.method}']['${route.path}']['request']`;
      // Discriminant literal is lower-cased to match the runtime-injected
      // value (the parser normalizes `Content-Type` to lower case); the type
      // navigation keeps the author's original key so the schema resolves.
      const union = route.requestContentTypes
        .map(
          (ct) =>
            `({ contentType: '${ct.toLowerCase()}' } & StandardSchemaV1.InferOutput<${base}['${ct}']>)`,
        )
        .join(' | ');
      appInfoOverrides.push(`request: ${union}`);
    } else {
      appInfoOverrides.push(
        `request: StandardSchemaV1.InferOutput<${routesAlias}['${route.method}']['${route.path}']['request']>`,
      );
    }
  }
  if (route.hasQuerySchema) {
    appInfoOverrides.push(
      `query: StandardSchemaV1.InferOutput<${routesAlias}['${route.method}']['${route.path}']['query']>`,
    );
  }
  const appInfoOverride =
    appInfoOverrides.length > 0 ? ` & { ${appInfoOverrides.join('; ')} }` : '';

  return `BaseRequestContext & { appInfo: UnionAppInfoProvides<${tupleInner}>${appInfoOverride} }${paramsOverride}`;
}

/**
 * Pull path-param names out of a route path string. Handles `:name` (single
 * segment) and `{*name}` (splat — author-facing syntax that the registry
 * normalizes to internal `*name` for matching).
 */
function parsePathParams(routePath: string): string[] {
  const names: string[] = [];
  for (const match of routePath.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    names.push(match[1] as string);
  }
  for (const match of routePath.matchAll(/\{\*([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
    names.push(match[1] as string);
  }
  return names;
}

function collectUniqueMiddlewares(chains: MiddlewareRef[][]): string[] {
  const set = new Set<string>();
  for (const chain of chains) {
    for (const mw of chain) {
      set.add(mw.className);
    }
  }
  return Array.from(set);
}

function pascalCase(name: string): string {
  if (name.length === 0) {
    return name;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
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
 *  - Only ancestors with a *resolvable local source path* are walked.
 *    Bare-package ancestors (e.g. extending a class from `node_modules`)
 *    are skipped because their `.ts` source isn't accessible at codegen
 *    time. The child either re-imports inherited middlewares explicitly
 *    or those middlewares get filtered out as today.
 */
async function buildExtendsImportMap(
  srcPath: string,
  source: string,
): Promise<Map<string, string>> {
  const merged = new Map<string, string>();
  const visited = new Set<string>();

  async function visit(filePath: string, fileSource: string): Promise<void> {
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
    if (parentName) {
      const parentImportPath = localImports.get(parentName);
      if (parentImportPath) {
        const parentSrcPath = resolveSiblingSource(filePath, parentImportPath);
        if (parentSrcPath !== null) {
          try {
            const parentSource = await fs.readFile(parentSrcPath, 'utf8');
            await visit(parentSrcPath, parentSource);
          } catch {
            // Parent source unreachable — skip silently. The child's own
            // imports still apply.
          }
        }
      }
    }
    // Apply this level's imports AFTER ancestors so we overwrite collisions.
    for (const [name, importPath] of localImports) {
      merged.set(name, importPath);
    }
  }

  await visit(srcPath, source);
  return merged;
}

/** `class X extends Y {` → `'Y'`. Returns `null` if no extends clause. */
function parseExtendsParent(source: string): string | null {
  const m = source.match(/\bclass\s+\w+\s+extends\s+(\w+)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Given an import path used by `fromFile`, resolve it to an absolute
 * source path if it points at a local `.ts` sibling. Returns `null` for
 * bare-package specifiers and for paths whose target isn't a readable
 * `.ts` file.
 */
function resolveSiblingSource(
  fromFile: string,
  importPath: string,
): string | null {
  if (!importPath.startsWith('.')) {
    return null; // bare package, can't resolve locally
  }
  const fromDir = path.dirname(fromFile);
  // Strip the trailing `.js` / `.ts` (we want the `.ts` file)
  const stripped = importPath.replace(/\.(js|ts)$/, '');
  return path.resolve(fromDir, `${stripped}.ts`);
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

/**
 * Find the framework's `src/` root by walking up from `srcPath` until we hit
 * a directory whose name is `src`. Used to compute import paths to framework
 * type modules. Falls back to walking up from this file's location.
 */
function findFrameworkSrcRoot(_srcPath: string): string {
  // Use this module's own location to find src/, since we ship inside the
  // framework. `import.meta.url` resolves to .../src/codegen/emit.ts.
  const here = fileURLToPath(new URL('.', import.meta.url));
  // here = .../src/codegen/
  return path.resolve(here, '..');
}

/** Compute a TS-style relative import specifier from `fromDir` to `toFile`. */
function relativeImport(fromDir: string, toFile: string): string {
  let rel = path.relative(fromDir, toFile);
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  // Ensure forward slashes (cross-platform)
  return rel.split(path.sep).join('/');
}
