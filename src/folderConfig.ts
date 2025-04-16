import path from 'node:path';

const basePath = new URL('.', import.meta.url).pathname;

export default {
  folders: {
    config: path.resolve(basePath, './config'),
    models: path.resolve(basePath, './models'),
    controllers: path.resolve(basePath, './controllers'),
    locales: path.resolve(basePath, './locales'),
    emails: path.resolve(basePath, './services/messaging/email/templates'),
    commands: path.resolve(basePath, './commands'),
    migrations: path.resolve(basePath, './migrations'),
  },
};

/**
 * @param config path to folder with config files
 * @param models path to folder with moidels files
 * @param controllers path to folder with controllers files
 * @param migrations path to folder with migrations files
 * @param locales path to folder with locales files
 * @param migrations path to folder with migrations files
 * @param [emails] path to folder with emails files. Optional
 */
type TFolderConfigFolders = {
  config: string;
  models: string;
  controllers: string;
  commands: string;
  locales: string;
  migrations: string;
  emails?: string;
};

type TFolderConfig = {
  folders: TFolderConfigFolders;
};

export { type TFolderConfig, type TFolderConfigFolders };
