/**
 * App-level type generation. Emits a single `genTypes.d.ts` at
 * `process.cwd()` that augments `IApp` so `getConfig('foo')` and
 * `getModel('Bar')` are typed against the project's actual config /
 * model files.
 */

import fs from 'node:fs/promises';
import { BaseModel } from '../modules/BaseModel.ts';
import type { IApp } from '../server.ts';

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
 * `undefined`-valued object keys are dropped (a field whose value is absent at
 * gen time has no knowable type; same as the historical `JSON.stringify` form).
 */
function valueToTypeString(value: unknown): string {
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
          : `[${value.map(valueToTypeString).join(', ')}]`;
      }
      // Only walk plain objects; anything exotic (Date, RegExp, Map, …) is opaque.
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        return 'unknown';
      }
      const entries = Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v !== undefined,
      );
      if (entries.length === 0) {
        return '{}';
      }
      const body = entries
        .map(([k, v]) => `${JSON.stringify(k)}: ${valueToTypeString(v)}`)
        .join('; ');
      return `{ ${body} }`;
    }
    default:
      return 'unknown';
  }
}

/** Render the `genTypes.d.ts` template text from config values + model paths. */
export async function getTemplate(
  configs: Map<string, unknown>,
  modelPaths: { file: string; path: string }[],
): Promise<string> {
  const dir = process.cwd();
  const configTypes = Array.from(configs)
    .map(
      ([name, value]) =>
        `    getConfig(configName: '${name}'): ${valueToTypeString(value)};`,
    )
    .join('\n');

  const modelTypes = (
    await Promise.all(
      modelPaths.map(async (modelPath) => {
        const modelModule = await import(modelPath.path);
        const relPath = modelPath.path.replace(dir, '.');
        if (modelModule.default.prototype instanceof BaseModel) {
          return `    getModel(modelName: '${modelPath.file}'): GetModelTypeFromClass<typeof import('${relPath}').default>`;
        }
        return `    getModel(modelName: '${modelPath.file}'): import('${relPath}').default['mongooseModel']`;
      }),
    )
  ).join('\n');

  // Bind `req.appInfo.user` to the project's `User` model (if it's a BaseModel),
  // so it follows a replaced model exactly like `getModel('User')` does.
  const userModel = modelPaths.find((m) => m.file === 'User');
  let userAppInfo = '';
  if (userModel) {
    const mod = await import(userModel.path);
    if (mod.default?.prototype instanceof BaseModel) {
      const relPath = userModel.path.replace(dir, '.');
      userAppInfo = `
declare module '@adaptivestone/framework/models/User.js' {
  export interface AppModels {
    User: GetModelTypeFromClass<typeof import('${relPath}').default>;
  }
}
`;
    }
  }

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
