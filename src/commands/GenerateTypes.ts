import fs from 'node:fs/promises';
import AbstractCommand from '../modules/AbstractCommand.ts';
import { BaseModel } from '../modules/BaseModel.ts';

class GenerateTypes extends AbstractCommand {
  static get description(): string {
    return 'Gererates TypeScript types';
  }

  static isShouldInitModels = false;

  async run(): Promise<boolean> {
    const template = await GenerateTypes.getTemplate(
      this.app.internalFilesCache.configs,
      this.app.internalFilesCache.modelPaths,
    );
    await fs.writeFile(`${process.cwd()}/genTypes.d.ts`, template);

    console.log('TypeScript types generated successfully at genTypes.d.ts');

    return Promise.resolve(true);
  }

  static async getTemplate(
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
          const path = modelPath.path.replace(dir, '.');
          if (modelModule.default.prototype instanceof BaseModel) {
            return `    getModel(modelName: '${modelPath.file}'): GetModelTypeFromClass<typeof import('${path}').default>`;
          } else {
            return `    getModel(modelName: '${modelPath.file}'): import('${path}').default['mongooseModel']`;
          }
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
}

export default GenerateTypes;
