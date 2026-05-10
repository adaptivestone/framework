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

/** Render the `genTypes.d.ts` template text from configs + model paths. */
export async function getTemplate(
  configs: Map<string, unknown>,
  modelPaths: { file: string; path: string }[],
): Promise<string> {
  const dir = process.cwd();
  const configTypes = Array.from(configs)
    .map(
      (config) =>
        `    getConfig(configName: '${config[0]}'): ${JSON.stringify(config[1], null, 6)};`,
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
