/**
 * Render one controller's metadata + resolved middleware chains into
 * `<File>.routes.gen.ts` text. The output matches the hand-written format
 * shipped in step 1.5 — same import shape, same per-handler `<Method>Request`
 * aliases, same `InstanceType<typeof Controller>['routes']` navigation pattern.
 *
 * Middleware import bindings + specifiers are resolved in `importResolution.ts`
 * (the heavy part — reconstructing paths from controller source); this file just
 * renders the resolved chains into text. Framework types (`BaseRequestContext`,
 * `StandardSchemaV1`) are computed relative to the controller's location.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ControllerMeta,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';
import {
  buildExtendsImportMap,
  type ModuleNamespace,
  relativeImport,
  resolveBinding,
} from './importResolution.ts';

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
  const ctrlDir = path.dirname(srcPath);

  // Resolve each chain entry to the *local import binding* the controller (or
  // an ancestor) uses for it, and drop entries not imported anywhere in the
  // extends chain. Two cases collapse here:
  //  - binding === class name (the common case) → matched directly by name.
  //  - binding !== class name (a default export aliased on import, e.g.
  //    `Auth.ts` exports `AuthMiddleware` but controllers `import Auth`) →
  //    matched by module identity against the live class.
  //  - imported nowhere (cross-controller `/{*splat}` bleed) → dropped.
  // `className` is rewritten to the binding so the import line, the
  // `typeof <binding>` reference, and the import-map lookup all agree.
  const moduleCache = new Map<string, ModuleNamespace | null>();
  const bindingCache = new Map<unknown, string | null>();
  const filteredChains: MiddlewareRef[][] = [];
  for (const chain of chains) {
    const resolved: MiddlewareRef[] = [];
    for (const mw of chain) {
      const binding = await resolveBinding(
        mw,
        importMap,
        ctrlDir,
        moduleCache,
        bindingCache,
      );
      if (binding !== null) {
        resolved.push({ ...mw, className: binding });
      }
    }
    filteredChains.push(resolved);
  }
  return renderGenFile({ controller, srcPath, filteredChains, importMap });
}

/**
 * Inputs for the pure renderer — resolution (the middleware chains as binding
 * names + the `binding → specifier` import map) is already done by the caller.
 */
export interface RenderInput {
  controller: ControllerMeta;
  /** Absolute path to the controller's source `.ts` file. */
  srcPath: string;
  /** Resolved+filtered chains (binding names), parallel to `controller.routes`. */
  filteredChains: MiddlewareRef[][];
  /** `binding → specifier` for every binding referenced in `filteredChains`. */
  importMap: Map<string, string>;
}

/**
 * Render the gen.ts text from already-resolved chains + import map. Shared by the
 * boot path (`emitGenFile`, which resolves bindings via `importResolution`) and
 * the AST path (which resolves them from parsed source) — so both produce
 * byte-identical output given the same resolved inputs.
 */
export function renderGenFile(input: RenderInput): string {
  const { controller, srcPath, filteredChains, importMap } = input;
  const ctrlDir = path.dirname(srcPath);
  const uniqueMiddlewares = collectUniqueMiddlewares(filteredChains);

  const frameworkRoot = findFrameworkSrcRoot(srcPath);
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
