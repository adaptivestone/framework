/**
 * Codegen model detection via AST (plan: `.plans/refactor/queued/codegen-ast.md`
 * Phase 5 / P1j Phase 3). Decides whether a model is a `BaseModel` subclass by
 * walking its `extends` chain in SOURCE — so `appTypes` no longer `import()`s
 * every model file (which drags in Mongoose and the whole model graph) just to
 * run an `instanceof` check.
 */

import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { extractController } from './astExtract.ts';
import { resolveRelativeFile } from './paths.ts';

/**
 * Is the model at `srcPath` a `BaseModel` subclass? Walks the `extends` chain in
 * source (relative AND bare-package ancestors), matching the framework's
 * `BaseModel` module by its specifier basename — so an aliased import
 * (`import { BaseModel as BM }`) is handled too. No runtime import.
 */
export async function isBaseModelSource(
  srcPath: string,
  depth = 0,
  cache?: Map<string, boolean>,
): Promise<boolean> {
  const cached = cache?.get(srcPath);
  if (cached !== undefined) {
    return cached;
  }
  const result = await computeIsBaseModelSource(srcPath, depth, cache);
  cache?.set(srcPath, result);
  return result;
}

async function computeIsBaseModelSource(
  srcPath: string,
  depth: number,
  cache?: Map<string, boolean>,
): Promise<boolean> {
  if (depth > 5) {
    return false;
  }
  let source: string;
  try {
    source = await fs.readFile(srcPath, 'utf8');
  } catch {
    return false;
  }
  const ex = extractController(source, srcPath);
  if (!ex.extendsName) {
    return false;
  }
  const info = ex.imports[ex.extendsName];
  if (!info) {
    // Unresolved import — fall back to the binding name (`extends BaseModel`).
    return ex.extendsName === 'BaseModel';
  }
  // Direct: extends a class imported from the framework's `BaseModel` module.
  if (moduleBaseName(info.specifier) === 'BaseModel') {
    return true;
  }
  // Indirect: `class User extends MyBase` where `MyBase extends BaseModel`.
  const parent = resolveRelativeOrBare(info.specifier, srcPath);
  return parent ? isBaseModelSource(parent, depth + 1, cache) : false;
}

/** A specifier's module name without directory or extension (`…/BaseModel.js` → `BaseModel`). */
function moduleBaseName(spec: string): string {
  return (spec.split('/').pop() ?? '').replace(/\.[jt]s$/, '');
}

/** Resolve an extends specifier to a source file: relative (probe `.ts`/`.js`/
 * `index.*`) or bare-package (through the importing file's module resolution). */
function resolveRelativeOrBare(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    return resolveRelativeFile(path.dirname(fromFile), spec);
  }
  try {
    return createRequire(fromFile).resolve(spec);
  } catch {
    return null;
  }
}
