/**
 * OpenAPI 3.1 generator.
 *
 * Pure function: takes the flattened route list (`RouteRegistry.flatten()`) and
 * emits an OpenAPI document. No CLI, no fs, no app boot — the `openapi` command
 * (`src/commands/OpenApi.ts`) populates the registry and hands the routes here.
 *
 * Schema → JSON Schema goes through the validator driver seam
 * (`ValidateService.resolve(schema).toJsonSchema`), so any vendor with
 * introspection (zod native, yup `describe()`, arktype, or a user-registered
 * driver) is documented; vendors without it degrade to a placeholder + warning.
 * The same seam powers the future MCP surface — nothing here is OpenAPI-only
 * throwaway.
 */

import type { AuthParameter } from '../http/middleware/AbstractMiddleware.ts';
import type { FlatRoute, MiddlewareEntry } from '../http/routing/RouteNode.ts';
import { isContentTypeRequestMap } from '../validate/contentType.ts';
import type { JsonSchema, StandardSchemaV1 } from '../validate/types.ts';
import ValidateService from '../validate/ValidateService.ts';

export interface OpenApiInfo {
  title: string;
  description?: string;
  version: string;
  contact?: { email?: string };
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface GenerateOpenApiOptions {
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  /** Called once per route/field whose schema can't be introspected. */
  onWarning?: (message: string) => void;
}

type Obj = Record<string, unknown>;

/**
 * Build an OpenAPI 3.1 document from flattened routes.
 */
export async function generateOpenApi(
  routes: FlatRoute[],
  opts: GenerateOpenApiOptions,
): Promise<Obj> {
  const warn = opts.onWarning ?? (() => {});
  const paths: Obj = {};
  const securitySchemes: Obj = {};
  const tagNames = new Set<string>();
  const usedIds = new Set<string>();

  for (const route of routes) {
    const { path, params: pathParams, hadSplat } = convertPath(route.path);
    if (hadSplat) {
      warn(
        `${route.method} ${route.path}: catch-all (*) approximated as a path parameter — OpenAPI has no catch-all.`,
      );
    }

    const meta = route.entry.meta ?? {};
    const tag = (meta.controllerClass ?? 'default').split('/')[0] as string;
    tagNames.add(tag);

    const parameters: Obj[] = pathParams.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const ctx = `${route.method} ${path}`;
    parameters.push(...(await buildQueryParameters(route, warn, ctx)));

    const operation: Obj = {
      operationId: operationId(route, tag, path, usedIds),
      tags: [tag],
      responses: defaultResponses(),
    };
    if (meta.description) {
      operation.summary = meta.description;
    }
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    const requestBody = await buildRequestBody(route, warn, ctx);
    if (requestBody) {
      operation.requestBody = requestBody;
    }

    const security = collectSecurity(route.middlewares, securitySchemes);
    if (security.length > 0) {
      operation.security = security;
    }

    let pathItem = paths[path] as Obj | undefined;
    if (!pathItem) {
      pathItem = {};
      paths[path] = pathItem;
    }
    pathItem[route.method.toLowerCase()] = operation;
  }

  const doc: Obj = {
    openapi: '3.1.0',
    info: opts.info,
    paths,
    tags: [...tagNames].sort().map((name) => ({ name })),
    components: { securitySchemes },
  };
  if (opts.servers && opts.servers.length > 0) {
    doc.servers = opts.servers;
  }
  return doc;
}

// ── path ──────────────────────────────────────────────────────────────────────

/** `:id` → `{id}`, trailing `*rest` → `{rest}` (splat approximated). */
function convertPath(internalPath: string): {
  path: string;
  params: string[];
  hadSplat: boolean;
} {
  const params: string[] = [];
  let hadSplat = false;
  const out = internalPath
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        const name = seg.slice(1);
        params.push(name);
        return `{${name}}`;
      }
      if (seg.startsWith('*')) {
        hadSplat = true;
        const name = seg.slice(1) || 'splat';
        params.push(name);
        return `{${name}}`;
      }
      return seg;
    })
    .join('/');
  return { path: out || '/', params, hadSplat };
}

/**
 * Controller-namespaced, document-unique operationId. `controllerName` is the
 * same value `tags` uses, so the two stay consistent. On residual collision
 * (one handler wired to multiple verbs/paths) disambiguate deterministically:
 * append the lowercased HTTP verb, then a numeric suffix. `usedIds` accumulates
 * across the document and is mutated with the chosen id.
 */
function operationId(
  route: FlatRoute,
  controllerName: string,
  path: string,
  usedIds: Set<string>,
): string {
  const base = baseOperationId(route, controllerName, path);
  let candidate = base;
  if (usedIds.has(candidate)) {
    candidate = `${base}_${route.method.toLowerCase()}`;
  }
  if (usedIds.has(candidate)) {
    const stem = candidate;
    let n = 2;
    while (usedIds.has(`${stem}_${n}`)) {
      n += 1;
    }
    candidate = `${stem}_${n}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function baseOperationId(
  route: FlatRoute,
  controllerName: string,
  path: string,
): string {
  const name = route.entry.meta?.methodName;
  if (name) {
    return `${controllerName}_${name}`;
  }
  const slug = path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${route.method.toLowerCase()}_${slug || 'root'}`;
}

// ── schema conversion ──────────────────────────────────────────────────────────

/** Resolve a schema's driver and emit JSON Schema; null when not introspectable. */
async function schemaToJson(schema: unknown): Promise<JsonSchema | null> {
  const driver = ValidateService.resolve(schema);
  if (!driver?.toJsonSchema) {
    return null;
  }
  const result = await driver.toJsonSchema(schema);
  if (!result) {
    return null;
  }
  // `$schema` is a standalone-document marker; invalid when embedded in OpenAPI.
  const { $schema, ...rest } = result as Obj;
  return rest as JsonSchema;
}

function placeholderSchema(): JsonSchema {
  return {
    type: 'object',
    description:
      'Schema introspection unavailable for this validator (no toJsonSchema). Body shape not documented.',
  };
}

/**
 * Combine body schemas. A single schema passes through untouched (keeps its
 * top-level keys — `description`, `additionalProperties`, non-object types).
 * Multiple are shallow-merged into one object schema (route body + middleware
 * params), mirroring the runtime's `Object.assign` of validated parts.
 */
function combineSchemas(schemas: JsonSchema[]): JsonSchema {
  return schemas.length === 1 ? schemas[0] : mergeObjectSchemas(schemas);
}

/** Shallow-merge object JSON Schemas: union `properties` + `required`. */
function mergeObjectSchemas(schemas: JsonSchema[]): JsonSchema {
  const properties: Obj = {};
  const required = new Set<string>();
  for (const schema of schemas) {
    const props = schema.properties;
    if (props && typeof props === 'object') {
      Object.assign(properties, props);
    }
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        required.add(key as string);
      }
    }
  }
  const out: JsonSchema = { type: 'object', properties };
  if (required.size > 0) {
    out.required = [...required];
  }
  return out;
}

function hasBinaryField(schema: JsonSchema): boolean {
  const props = schema.properties;
  if (!props || typeof props !== 'object') {
    return false;
  }
  return Object.values(props as Obj).some(
    (p) => p != null && typeof p === 'object' && (p as Obj).format === 'binary',
  );
}

// ── middleware-contributed schemas ──────────────────────────────────────────────

/** Read static `relatedRequestParameters` / `relatedQueryParameters` off classes. */
function collectMiddlewareSchemas(
  middlewares: MiddlewareEntry[],
  kind: 'request' | 'query',
): StandardSchemaV1[] {
  const prop =
    kind === 'request' ? 'relatedRequestParameters' : 'relatedQueryParameters';
  const out: StandardSchemaV1[] = [];
  for (const mw of middlewares) {
    const schema = (mw.Class as unknown as Record<string, unknown>)[prop];
    if (schema) {
      out.push(schema as StandardSchemaV1);
    }
  }
  return out;
}

// ── query / body / security ─────────────────────────────────────────────────────

async function buildQueryParameters(
  route: FlatRoute,
  warn: (m: string) => void,
  ctx: string,
): Promise<Obj[]> {
  const schemas: unknown[] = [
    ...(route.entry.query ? [route.entry.query] : []),
    ...collectMiddlewareSchemas(route.middlewares, 'query'),
  ];
  const params: Obj[] = [];
  for (const schema of schemas) {
    const json = await schemaToJson(schema);
    if (!json) {
      warn(`${ctx} query: schema introspection unavailable — params omitted.`);
      continue;
    }
    const props = (json.properties as Obj) ?? {};
    const required = new Set(
      Array.isArray(json.required) ? (json.required as string[]) : [],
    );
    for (const [name, propSchema] of Object.entries(props)) {
      params.push({
        name,
        in: 'query',
        required: required.has(name),
        schema: propSchema,
      });
    }
  }
  return params;
}

async function buildRequestBody(
  route: FlatRoute,
  warn: (m: string) => void,
  ctx: string,
): Promise<Obj | undefined> {
  const req = route.entry.request;
  const mwSchemas = collectMiddlewareSchemas(route.middlewares, 'request');
  const mwParts = (
    await Promise.all(mwSchemas.map((s) => schemaToJson(s)))
  ).filter((s): s is JsonSchema => s != null);

  // Content-type map → one media type per declared key (native multipart support).
  if (req && isContentTypeRequestMap(req)) {
    const content: Obj = {};
    for (const [mediaType, schema] of Object.entries(req)) {
      const converted = await schemaToJson(schema);
      if (!converted) {
        warn(`${ctx} body (${mediaType}): schema introspection unavailable.`);
      }
      const merged = combineSchemas([
        converted ?? placeholderSchema(),
        ...mwParts,
      ]);
      content[mediaType] = { schema: merged };
    }
    return { content };
  }

  // Single schema (or none).
  let routeObj: JsonSchema | null = null;
  if (req) {
    routeObj = await schemaToJson(req);
    if (!routeObj) {
      warn(
        `${ctx} body: schema introspection unavailable — placeholder emitted.`,
      );
    }
  }

  const parts = [
    ...(routeObj ? [routeObj] : req ? [placeholderSchema()] : []),
    ...mwParts,
  ];
  if (parts.length === 0) {
    return undefined; // no declared body
  }

  const schema = combineSchemas(parts);
  const mediaType = hasBinaryField(schema)
    ? 'multipart/form-data'
    : 'application/json';
  return { content: { [mediaType]: { schema } } };
}

function collectSecurity(
  middlewares: MiddlewareEntry[],
  securitySchemes: Obj,
): Obj[] {
  const requirements: Obj[] = [];
  const seen = new Set<string>();
  for (const mw of middlewares) {
    const params = (mw.Class as unknown as { usedAuthParameters?: unknown })
      .usedAuthParameters;
    if (!Array.isArray(params)) {
      continue;
    }
    for (const param of params as AuthParameter[]) {
      if (!securitySchemes[param.name]) {
        securitySchemes[param.name] = toSecurityScheme(param);
      }
      if (!seen.has(param.name)) {
        seen.add(param.name);
        requirements.push({ [param.name]: [] });
      }
    }
  }
  return requirements;
}

function toSecurityScheme(param: AuthParameter): Obj {
  if (param.type === 'apiKey') {
    return {
      type: 'apiKey',
      name: param.name,
      in: param.in ?? 'header',
      description: param.description,
    };
  }
  if (param.type === 'http') {
    return {
      type: 'http',
      scheme: param.scheme ?? 'bearer',
      description: param.description,
    };
  }
  return { type: param.type, description: param.description };
}

function defaultResponses(): Obj {
  return {
    '200': { description: 'Successful response' },
    '400': { description: 'Validation error' },
    '401': { description: 'Unauthorized' },
    '404': { description: 'Not found' },
  };
}
