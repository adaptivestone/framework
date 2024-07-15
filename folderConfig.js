import path from 'node:path';

export default {
  folders: {
    config: path.resolve('./config'),
    models: path.resolve('./models'),
    controllers: path.resolve('./controllers'),
    views: path.resolve('./views'),
    locales: path.resolve('./locales'),
    emails: path.resolve('./services/messaging/email/templates'),
    commands: path.resolve('./commands'),
    migrations: path.resolve('./migrations'),
  },
};
