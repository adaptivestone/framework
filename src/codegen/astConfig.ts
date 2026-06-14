/**
 * Config env-key detection via AST. The value-based config type generator
 * (`appTypes.ts`) renders each config's *runtime* shape — which is accurate for
 * everything that has a value at gen time, but a key read straight from the
 * environment with **no default** (`saltSecret: process.env.AUTH_SALT`) is
 * `undefined` then, so it gets dropped from the generated type and every read
 * needs an `as` cast.
 *
 * This module recovers exactly those keys by reading the config SOURCE: a bare
 * `process.env.X` is always `string | undefined` regardless of whether the var
 * happens to be set during codegen, so we can type it correctly without ever
 * importing the value. Keys that DO have a value at gen time (a literal, or
 * `process.env.X || default`) are left to the value-based pass — it already
 * types them, including the default's contribution.
 *
 * No runtime import (Mongoose/secrets never load); parsed with `oxc-parser`,
 * the same front-end the rest of codegen uses.
 *
 * Scope: only `process.env` reads written INLINE in a config's own default-
 * exported object literal are recovered. A key whose env read lives in a spread-
 * in base (`export default { ...frameworkConfig, … }`) or behind an indirection
 * (`const x = process.env.Y; export default { x }`) is not followed across that
 * boundary — it falls back to the value-based pass (i.e. dropped if `undefined`
 * at gen time, as before this feature). Inline reads cover the common case (a
 * project's own `apiKey: process.env.X`); cross-module spread resolution is
 * deliberately out of scope.
 */

import { promises as fs } from 'node:fs';
import merge from 'deepmerge';
import { parseSync } from 'oxc-parser';

/**
 * Env-derived key types for one config, mirroring its nesting. A string leaf is
 * the TypeScript type for that key (e.g. `'string | undefined'`); a nested
 * object is a sub-shape.
 */
export type EnvShape = { [key: string]: string | EnvShape };

// oxc nodes are untyped here (no shared d.ts); narrow structurally as we walk.
// biome-ignore lint/suspicious/noExplicitAny: AST nodes from oxc-parser
type Node = any;

/** True for `process.env.X` and `process.env['X']` (the dropped, no-default form). */
function isProcessEnv(node: Node): boolean {
  return (
    node?.type === 'MemberExpression' &&
    node.object?.type === 'MemberExpression' &&
    node.object.object?.type === 'Identifier' &&
    node.object.object.name === 'process' &&
    node.object.property?.type === 'Identifier' &&
    node.object.property.name === 'env'
  );
}

/** Strip `as T` / `satisfies T` wrappers; report `!` so we can drop the `undefined`. */
function unwrap(node: Node): { node: Node; nonNull: boolean } {
  let n = node;
  let nonNull = false;
  while (
    n?.type === 'TSAsExpression' ||
    n?.type === 'TSSatisfiesExpression' ||
    n?.type === 'TSNonNullExpression' ||
    n?.type === 'ParenthesizedExpression'
  ) {
    if (n.type === 'TSNonNullExpression') {
      nonNull = true;
    }
    n = n.expression;
  }
  return { node: n, nonNull };
}

/** The env type contributed by a value expression, or null to defer to the
 * value-based pass (literal, logical-with-default, function call, …). */
function envTypeOf(valueNode: Node): string | EnvShape | null {
  const { node, nonNull } = unwrap(valueNode);
  if (isProcessEnv(node)) {
    // `process.env.X!` asserts the value is present → `string`; otherwise the
    // honest type of an unset env var is `string | undefined`.
    return nonNull ? 'string' : 'string | undefined';
  }
  if (node?.type === 'ObjectExpression') {
    const nested = shapeOfObject(node);
    return Object.keys(nested).length > 0 ? nested : null;
  }
  return null;
}

/** Walk an object literal's properties into an {@link EnvShape} (env keys only). */
function shapeOfObject(obj: Node): EnvShape {
  const shape: EnvShape = {};
  for (const prop of obj.properties ?? []) {
    if (prop.type !== 'Property') {
      continue; // SpreadElement, methods — not statically env-typable here
    }
    let key: string | null = null;
    if (!prop.computed && prop.key?.type === 'Identifier') {
      key = prop.key.name;
    } else if (
      prop.key?.type === 'Literal' &&
      typeof prop.key.value === 'string'
    ) {
      key = prop.key.value;
    }
    if (key === null) {
      continue;
    }
    const t = envTypeOf(prop.value);
    if (t !== null) {
      shape[key] = t;
    }
  }
  return shape;
}

/** Resolve a file's `export default` to its object literal (direct, via a
 * `const`, or wrapped in `as`/`satisfies`). Returns null if not an object. */
function findDefaultExportObject(body: Node[]): Node | null {
  const def = body.find((n) => n.type === 'ExportDefaultDeclaration');
  if (!def) {
    return null;
  }
  const { node } = unwrap(def.declaration);
  if (node?.type === 'ObjectExpression') {
    return node;
  }
  if (node?.type === 'Identifier') {
    // `const cfg = {…}; export default cfg;`
    for (const stmt of body) {
      if (stmt.type !== 'VariableDeclaration') {
        continue;
      }
      for (const d of stmt.declarations ?? []) {
        if (d.id?.type === 'Identifier' && d.id.name === node.name && d.init) {
          const init = unwrap(d.init).node;
          return init?.type === 'ObjectExpression' ? init : null;
        }
      }
    }
  }
  return null;
}

/** Extract the env-only key types from one config source file. Any read/parse
 * problem yields an empty shape — codegen then just falls back to value-based. */
export async function extractConfigEnvShape(
  srcPath: string,
): Promise<EnvShape> {
  let source: string;
  try {
    source = await fs.readFile(srcPath, 'utf8');
  } catch {
    return {};
  }
  try {
    const { program } = parseSync(srcPath, source);
    const obj = findDefaultExportObject(program.body as Node[]);
    return obj ? shapeOfObject(obj) : {};
  } catch {
    return {};
  }
}

/** Deep-merge the env shapes from a config's contributing files (default +
 * NODE_ENV override) with `deepmerge`: later sources win, nested shapes merge
 * key-wise — mirroring how the loader merges the values themselves. (Env shapes
 * only ever hold string leaves and nested objects, never arrays, so the loader's
 * array-replace option has nothing to apply to here.) */
export function mergeEnvShapes(shapes: EnvShape[]): EnvShape {
  return shapes.length ? merge.all<EnvShape>(shapes) : {};
}

/** Render an {@link EnvShape} as a standalone TS type — used when a whole
 * sub-object is env-only and absent from the runtime value. */
export function envShapeToType(shape: EnvShape): string {
  const body = Object.entries(shape)
    .map(
      ([k, v]) =>
        `${JSON.stringify(k)}: ${typeof v === 'string' ? v : envShapeToType(v)}`,
    )
    .join('; ');
  return body ? `{ ${body} }` : '{}';
}
