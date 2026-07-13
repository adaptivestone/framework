/**
 * App-level type generation. Emits a single `genTypes.d.ts` at
 * `process.cwd()` that augments `IApp` so `getConfig('foo')` and
 * `getModel('Bar')` are typed against the project's actual config /
 * model files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IApp } from '../server.ts';
import {
  type EnvShape,
  envShapeToType,
  extractConfigEnvShape,
  mergeEnvShapes,
} from './astConfig.ts';
import { isBaseModelSource } from './astModel.ts';
import { sq } from './emit.ts';

/** A `./`-rooted, forward-slash specifier from `dir` to `target` for the emitted
 * `import('…')`. Throws if `target` is outside `dir` (can't be a relative import)
 * — better a clear error than an accidental absolute path baked into the file. */
function toRelativeSpecifier(dir: string, target: string): string {
  const rel = path.relative(dir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Model path "${target}" is outside the project root "${dir}"; cannot emit a relative import into genTypes.d.ts`,
    );
  }
  return `./${rel.split(path.sep).join('/')}`;
}

/** Subset of the framework logger we use here. */
export interface CodegenLogger {
  info?(msg: string): void;
  warn?(msg: string): void;
}

/** Generate the app-level `genTypes.d.ts` file. */
export async function generateAppTypes(
  app: IApp,
  logger?: CodegenLogger | null,
): Promise<void> {
  const template = await getTemplate(
    app.internalFilesCache.configs,
    app.internalFilesCache.modelPaths,
    app.internalFilesCache.configPaths,
  );
  await fs.writeFile(`${process.cwd()}/genTypes.d.ts`, template);
  logger?.info?.('TypeScript types generated successfully at genTypes.d.ts');
}

/**
 * Render a TypeScript type from a runtime config value's **shape** — value
 * *types* (`string`, `number`), never the literal values. This is emitted
 * inline (no `import()` to resolve, so output is robust across compilers and
 * module settings) and structure-preserving (arrays stay tuples, so patterns
 * like `Object.values(config.list[0])` keep precise per-element types) — while
 * never serializing a secret value into the generated file.
 *
 * A `undefined`-valued key is normally dropped (no knowable type at gen time).
 * `env` (from {@link extractConfigEnvShape}) overrides that for keys read from
 * the environment: a bare `process.env.X` is typed from source as `string |
 * undefined` REGARDLESS of the runtime value — so the emitted type is the same
 * whether or not the var happened to be set during codegen (deterministic
 * output, no `as` cast at the read site). Keys with a value at gen time and no
 * env-shape entry (literals, `process.env.X || default`) are typed from value.
 */
function valueToTypeString(value: unknown, env?: EnvShape): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'bigint':
      return 'bigint';
    case 'undefined':
      return 'undefined';
    case 'function':
      return '((...args: any[]) => any)';
    case 'object': {
      if (Array.isArray(value)) {
        return value.length === 0
          ? 'unknown[]'
          : `[${value.map((v) => valueToTypeString(v)).join(', ')}]`;
      }
      // Only walk plain objects; anything exotic (Date, RegExp, Map, …) is opaque.
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        return 'unknown';
      }
      const rendered = new Map<string, string>();
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const e = env?.[k];
        // A source-derived leaf type (a bare `process.env.X` read) WINS over the
        // runtime value: that value is whatever the env var happened to hold at
        // gen time (often a real string, often `undefined`), so trusting it would
        // make the emitted type flip with the ambient environment — `string` on a
        // machine where the var is set, `string | undefined` where it isn't, and
        // spurious `generatetypes --check` drift between them. The source says
        // `string | undefined`; that's the honest, environment-independent type.
        // Deliberate edge: if a NODE_ENV-specific file hard-codes a key that the
        // base file reads from env, the env shape still wins (`string |
        // undefined`) even though the override makes it always defined — a rare
        // pattern, and erring nullable is safe (a guard, never a wrong value).
        if (typeof e === 'string') {
          rendered.set(k, e);
          continue;
        }
        if (v === undefined) {
          continue; // recovered from a nested `env` shape below, if any
        }
        rendered.set(
          k,
          valueToTypeString(v, typeof e === 'object' ? e : undefined),
        );
      }
      // Recover env-only keys that never appeared in the value (dropped because
      // `undefined` at gen time, or a wholly env-only sub-object) — typed from
      // the source, never from a value.
      if (env) {
        for (const [k, t] of Object.entries(env)) {
          if (rendered.has(k)) {
            continue;
          }
          rendered.set(k, typeof t === 'string' ? t : envShapeToType(t));
        }
      }
      if (rendered.size === 0) {
        return '{}';
      }
      const body = Array.from(rendered)
        .map(([k, t]) => `${JSON.stringify(k)}: ${t}`)
        .join('; ');
      return `{ ${body} }`;
    }
    default:
      return 'unknown';
  }
}

/** Render the `genTypes.d.ts` template text from config values + model paths.
 *
 * `configPaths` (config name → contributing source files) is optional: when
 * present, env-only keys dropped by the value pass are recovered from source
 * (see {@link valueToTypeString}). Omitted by unit tests that pass raw values. */
export async function getTemplate(
  configs: Map<string, unknown>,
  modelPaths: { file: string; path: string }[],
  configPaths?: Map<string, string[]>,
): Promise<string> {
  const dir = process.cwd();

  // Parse each config's source(s) once for env-only keys (no value import).
  const envByConfig = new Map<string, EnvShape>();
  if (configPaths) {
    await Promise.all(
      Array.from(configPaths, async ([name, paths]) => {
        const shapes = await Promise.all(paths.map(extractConfigEnvShape));
        envByConfig.set(name, mergeEnvShapes(shapes));
      }),
    );
  }

  const configTypes = Array.from(configs)
    .map(
      ([name, value]) =>
        `    getConfig(configName: ${sq(name)}): ${valueToTypeString(value, envByConfig.get(name))};`,
    )
    .join('\n');

  // Detect `BaseModel` subclasses by parsing each model's source (no runtime
  // import — codegen never loads the model graph / Mongoose). Result drives both
  // the `getModel` emission and the `appInfo.user` augmentation below.
  // One probe cache for the whole run — a shared base model parses once.
  const modelCache = new Map<string, boolean>();
  const models = await Promise.all(
    modelPaths.map(async (modelPath) => ({
      file: modelPath.file,
      relPath: toRelativeSpecifier(dir, modelPath.path),
      isBaseModel: await isBaseModelSource(modelPath.path, 0, modelCache),
    })),
  );

  const modelTypes = models
    .map((m) =>
      m.isBaseModel
        ? `    getModel(modelName: ${sq(m.file)}): GetModelTypeFromClass<typeof import(${sq(m.relPath)}).default>`
        : `    getModel(modelName: ${sq(m.file)}): import(${sq(m.relPath)}).default['mongooseModel']`,
    )
    .join('\n');

  // Bind `req.appInfo.user` to the project's `User` model (if it's a BaseModel),
  // so it follows a replaced model exactly like `getModel('User')` does. The
  // augmentation feeds `AppUser`, which is the hydrated DOCUMENT — so wrap the
  // model class in `InstanceType<…>` (unlike `getModel('User')` above, which
  // returns the Model class itself).
  const userModel = models.find((m) => m.file === 'User' && m.isBaseModel);
  const userAppInfo = userModel
    ? `
declare module '@adaptivestone/framework/models/User.js' {
  export interface AppModels {
    User: InstanceType<GetModelTypeFromClass<typeof import(${sq(userModel.relPath)}).default>>;
  }
}
`
    : '';

  return `
import type {} from '@adaptivestone/framework/server.js';
import type { GetModelTypeFromClass } from '@adaptivestone/framework/modules/BaseModel.js';

declare module '@adaptivestone/framework/server.js' {
  export interface IApp {
      ${configTypes}
      ${modelTypes}
  }
}
${userAppInfo}`;
}
