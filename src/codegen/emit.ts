/**
 * Render one controller's metadata + resolved middleware chains into
 * `<File>.routes.gen.ts` text — per-handler `<Method>Request` aliases over the
 * `InstanceType<typeof Controller>['routes']` navigation pattern.
 *
 * Pure rendering: the caller (the AST front-end in `astEmit.ts`) supplies the
 * resolved chains as binding NAMES plus the `binding → specifier` import map.
 * Framework type paths (`BaseRequestContext`, `StandardSchemaV1`) are computed
 * relative to the controller's location.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ControllerMeta,
  MiddlewareImport,
  MiddlewareRef,
  RouteMeta,
} from './collectMetadata.ts';
import { relativeImport } from './paths.ts';

/**
 * Inputs for the renderer — resolution (the middleware chains as binding names +
 * the `binding → specifier` import map) is already done by the caller.
 */
export interface RenderInput {
  controller: ControllerMeta;
  /** Absolute path to the controller's source `.ts` file. */
  srcPath: string;
  /** Resolved+filtered chains (binding names), parallel to `controller.routes`. */
  filteredChains: MiddlewareRef[][];
  /** `binding → import` (specifier + kind) for every binding in `filteredChains`. */
  importMap: Map<string, MiddlewareImport>;
  /**
   * Whether the gen file may `import type` the controller's own module to
   * navigate its `routes` type for precise inline-schema `InferOutput`. False
   * for a `.js` controller with no sibling `.d.ts`: importing it would be a
   * `TS7016` ("no declaration file") under `strict` with no `allowJs`. When
   * false, inline request/query schemas degrade to the base
   * `Record<string, unknown>` (no self-import) so the consumer's typecheck gate
   * stays green during an incremental `.js` → `.ts` migration. `.ts`
   * controllers (and `.js` with a `.d.ts`) keep precise types.
   */
  controllerTypeImportable: boolean;
}

/**
 * Render the gen.ts text from already-resolved chains + import map. The AST
 * front-end (`astEmit.ts`) resolves the chains (binding names) + the import map
 * from parsed source and feeds them here.
 */
export function renderGenFile(input: RenderInput): string {
  const { controller, srcPath, filteredChains, importMap } = input;
  const ctrlDir = path.dirname(srcPath);
  const uniqueMiddlewares = collectUniqueMiddlewares(filteredChains);

  const frameworkRoot = findFrameworkSrcRoot();
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
  // Controllers may be .ts or .js (the runtime loader accepts both); the gen
  // file's self-import must use the controller's real extension.
  const ctrlExt = path.extname(srcPath);
  const ctrlBaseName = path.basename(srcPath, ctrlExt);
  const ctrlImportPath = `./${ctrlBaseName}${ctrlExt}`;

  const middlewareImports = uniqueMiddlewares
    .map((mw) => renderMiddlewareImport(mw, importMap.get(mw)))
    .sort();

  const routesAlias = `${controller.className}Routes`;
  const anyRouteHasSchema = controller.routes.some(
    (r) => r.hasSchema || r.hasQuerySchema,
  );
  // Only navigate the controller's own `routes` type (which requires importing
  // it) when that import would actually type-check. For an untyped `.js`
  // controller we degrade instead — inline schemas fall back to the permissive
  // base type rather than emit a `TS7016`-producing self-import.
  const navigateSchema = anyRouteHasSchema && input.controllerTypeImportable;
  const schemaDegraded = anyRouteHasSchema && !input.controllerTypeImportable;

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
    const block = renderHandlerGroup(group, routesAlias, navigateSchema);
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
  if (navigateSchema) {
    importLines.push(
      `import type { StandardSchemaV1 } from '${validateTypesPath}';`,
    );
    importLines.push(
      `import type ${controller.className} from '${ctrlImportPath}';`,
    );
  }
  const importBlock = importLines.join('\n');

  const routesAliasBlock = navigateSchema
    ? `\n/**\n * Type-level navigation into the controller's \`routes\` getter. Schema\n * references for inline schemas resolve through this alias.\n */\ntype ${routesAlias} = InstanceType<typeof ${controller.className}>['routes'];\n`
    : '';

  const degradedNote = schemaDegraded
    ? `\n *\n * NOTE: \`${ctrlBaseName}${ctrlExt}\` has no type declaration (no \`.d.ts\`), so its\n * inline request/query schemas fall back to \`Record<string, unknown>\` rather\n * than precise types. Convert it to TypeScript (or add a \`.d.ts\`) for full\n * request/response typing.`
    : '';
  const header = `/**
 * AUTOGENERATED — do not edit by hand.
 *
 * Regenerate with: \`npm run gen\`
 *
 * Source of truth: \`${ctrlBaseName}${ctrlExt}\`'s \`routes\` getter and
 * \`static get middleware()\` Map.${degradedNote}
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
  navigateSchema: boolean,
): string | null {
  if (group.length === 0 || !group[0]?.route.handlerName) {
    return null;
  }
  const handlerName = group[0].route.handlerName;
  const typeName = `${pascalCase(handlerName)}Request`;

  const docComment = group
    .map(
      ({ route }) =>
        `\`${route.method.toUpperCase()} ${escapeBlockComment(route.path)}\``,
    )
    .join(', ');
  // Dedup identical shapes (same chain + same schemas + same path params)
  // so multi-route handlers with structurally-equivalent contexts emit one
  // shape instead of an N-way union of identical branches.
  const allShapes = group.map(({ route, chain }) =>
    renderShape(route, chain, routesAlias, navigateSchema),
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
  navigateSchema: boolean,
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
      ? ` & { params: { ${pathParams.map((p) => `${paramKey(p)}: string`).join('; ')} } }`
      : '';

  // appInfo overrides for body/query when their schema is declared inline
  // on the route entry.
  const appInfoOverrides: string[] = [];
  if (route.hasSchema && navigateSchema) {
    if (route.requestContentTypes?.length) {
      // Content-type map → discriminated union keyed by `contentType`. Each
      // branch reads InferOutput of that media type's schema.
      const base = `${routesAlias}[${sq(route.method)}][${sq(route.path)}]['request']`;
      // Discriminant literal is lower-cased to match the runtime-injected
      // value (the parser normalizes `Content-Type` to lower case); the type
      // navigation keeps the author's original key so the schema resolves.
      const union = route.requestContentTypes
        .map(
          (ct) =>
            `({ contentType: ${sq(ct.toLowerCase())} } & StandardSchemaV1.InferOutput<${base}[${sq(ct)}]>)`,
        )
        .join(' | ');
      appInfoOverrides.push(`request: ${union}`);
    } else {
      appInfoOverrides.push(
        `request: StandardSchemaV1.InferOutput<${routesAlias}[${sq(route.method)}][${sq(route.path)}]['request']>`,
      );
    }
  }
  if (route.hasQuerySchema && navigateSchema) {
    appInfoOverrides.push(
      `query: StandardSchemaV1.InferOutput<${routesAlias}[${sq(route.method)}][${sq(route.path)}]['query']>`,
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
 *
 * A `:name` param is the WHOLE segment after `:` — the runtime router does
 * `seg.slice(1)` with no character restriction (`RouteRegistry`), so
 * `:order-id` → `order-id` and `:1st` → `1st` land in `req.params` verbatim;
 * matching `[^/]+` mirrors that. The splat form mirrors `convertPathSyntax`'s
 * `\{\*([a-zA-Z_][a-zA-Z0-9_]*)\}` exactly — a non-identifier there is NOT
 * normalized to a splat at runtime, so it must not be reported as a param here.
 */
function parsePathParams(routePath: string): string[] {
  const names: string[] = [];
  for (const match of routePath.matchAll(/:([^/]+)/g)) {
    names.push(match[1] as string);
  }
  for (const match of routePath.matchAll(/\{\*([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
    names.push(match[1] as string);
  }
  return names;
}

/**
 * Render a path-param name as an object-type key: bare when it is a valid TS
 * identifier (so identifier params stay byte-identical to the pre-quoting
 * output), single-quoted otherwise so full runtime segment names like
 * `order-id` or `1st` remain valid TS.
 */
function paramKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : sq(name);
}

/**
 * Emit the `import type` line for one middleware binding, matching the shape it
 * was imported with — a default import must not be forced onto a named export
 * (`TS2613`), and a renamed named import keeps its `Orig as Local` binding.
 */
function renderMiddlewareImport(
  binding: string,
  info: MiddlewareImport | undefined,
): string {
  const spec = info?.specifier ?? '';
  switch (info?.kind) {
    case 'named':
      return info.orig && info.orig !== binding
        ? `import type { ${info.orig} as ${binding} } from '${spec}';`
        : `import type { ${binding} } from '${spec}';`;
    case 'namespace':
      return `import type * as ${binding} from '${spec}';`;
    default:
      return `import type ${binding} from '${spec}';`;
  }
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

/**
 * Emit a single-quoted TS string literal for a type-navigation key, escaping the
 * only two characters a single-quoted string treats specially (`\` and `'`).
 * Route keys round-trip exactly (the literal denotes the author's original key),
 * and ordinary paths (no `\`/`'`) come out byte-identical to a plain `'${s}'`.
 */
export function sq(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Escape `*\/` so a route path that legally contains it (only a LEADING `*` is a
 * splat, so `/a*\/b` is a valid key) can't terminate the generated JSDoc block
 * comment (TS1443/TS1160). `*\/` reads identically; paths without it are
 * byte-identical. Only the doc comment needs this — type-navigation keys go
 * through `sq()` into string literals, where `*\/` is inert.
 */
function escapeBlockComment(s: string): string {
  return s.replace(/\*\//g, '*\\/');
}

function pascalCase(name: string): string {
  if (name.length === 0) {
    return name;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The framework's `src/` (or `dist/`) root — this module's own parent dir, since
 * codegen ships inside the framework. `import.meta.url` resolves to
 * `.../src/codegen/emit.ts`, so the root is one level up from `src/codegen/`.
 * Used to compute import paths to framework type modules.
 */
function findFrameworkSrcRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url)); // .../src/codegen/
  return path.resolve(here, '..');
}
