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
    app.internalFilesCache.configPaths,
    app.internalFilesCache.modelPaths,
  );
  await fs.writeFile(`${process.cwd()}/genTypes.d.ts`, template);
  logger?.info?.('TypeScript types generated successfully at genTypes.d.ts');
}

/** Render the `genTypes.d.ts` template text from config paths + model paths. */
export async function getTemplate(
  configPaths: Map<string, Record<string, string>>,
  modelPaths: { file: string; path: string }[],
): Promise<string> {
  const dir = process.cwd();
  // Emit `getConfig` as a reference to each config module's inferred type —
  // never a serialized value. Serializing live values leaks secrets into the
  // committed file and drops env-only fields (`JSON.stringify` omits
  // `undefined`). A config name resolves (post-inheritance) to one base file
  // plus optional `NODE_ENV` layers; the base is required, each extra layer is
  // `& Partial<…>` (deep-merged at runtime, optional and env-independent here).
  const typeRef = (filePath: string) =>
    `typeof import('${filePath.replace(dir, '.')}').default`;
  const configTypes = Array.from(configPaths)
    .map(([name, layers]) => {
      const baseKey = layers.default ? 'default' : Object.keys(layers)[0];
      const base = layers[baseKey];
      const overlays = Object.entries(layers)
        .filter(([key]) => key !== baseKey)
        .map(([, p]) => ` & Partial<${typeRef(p)}>`)
        .join('');
      return `    getConfig(configName: '${name}'): ${typeRef(base)}${overlays};`;
    })
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

  return `
import type {} from '@adaptivestone/framework/server.js';
import type { GetModelTypeFromClass } from '@adaptivestone/framework/modules/BaseModel.js';

declare module '@adaptivestone/framework/server.js' {
  export interface IApp {
      ${configTypes}
      ${modelTypes}
  }
}
`;
}
