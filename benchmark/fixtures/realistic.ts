import path from 'node:path';
import Server from '../../src/server.ts';

process.env.LOGGER_CONSOLE_LEVEL ||= 'error';
process.env.MONGO_DSN = '';

const basePath = new URL('.', import.meta.url).pathname;
const srcRoot = path.resolve(basePath, '../../src');

const server = new Server({
  folders: {
    config: path.resolve(srcRoot, 'config'),
    controllers: path.resolve(basePath, 'controllers'),
    models: path.resolve(srcRoot, 'models'),
    emails: path.resolve(srcRoot, 'services/messaging/email/templates'),
    locales: path.resolve(srcRoot, 'locales'),
    commands: path.resolve(srcRoot, 'commands'),
    migrations: path.resolve(srcRoot, 'migrations'),
  },
});

await server.init({ isSkipModelInit: true });
await server.startServer();

console.log('\nRealistic benchmark fixture ready on port 3300');
console.log('Routes:');
console.log('  GET /bench/plaintext     no validation, no i18n');
console.log('  GET /bench/echo?name=X   query validation + i18n lookup');
