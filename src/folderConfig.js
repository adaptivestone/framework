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
