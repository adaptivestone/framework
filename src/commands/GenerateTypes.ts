import AbstractCommand from '@adaptivestone/framework/modules/AbstractCommand.js';
import * as url from 'url';
import fs from 'node:fs/promises';

class GenerateTypes extends AbstractCommand {
  static get description(): string {
    return 'Gererates TypeScript types';
  }

  async getTypesContent(): Promise<string> {
    const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const content = await fs.readFile(
      `${__dirname}/../../../src/types/types.ts`,
      'utf8',
    );
    return content;
  }

  static isShouldInitModels = false;

  async run(): Promise<boolean> {
    const template = GenerateTypes.getTemplate(
      this.app.internalFilesCache.configs,
      this.app.internalFilesCache.modelPaths,
    );
    await fs.writeFile(`${process.cwd()}/genTypes.d.ts`, template);

    console.log('TypeScript types generated successfully at genTypes.d.ts');

    return Promise.resolve(true);
  }

  static getTemplate(
    configs: Map<string, any>,
    modelPaths: { file: string; path: string }[],
  ): string {
    const dir = process.cwd();
    const configTypes = Array.from(configs)
      .map((config) => {
        return `    getConfig(configName: '${config[0]}'): ${JSON.stringify(config[1], null, 6)};`;
      })
      .join('\n');

    const modelTypes = modelPaths
      .map((modelPath) => {
        const path = modelPath.path.replace(dir, '.');
        return `    getModel(modelName: '${modelPath.file}'): import('${path}').default['mongooseModel']`;
      })
      .join('\n');
    return `
import type {} from '@adaptivestone/framework/server.js';

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
