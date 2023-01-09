const path = require('node:path');

module.exports = {
  folders: {
    config: path.resolve('./config'),
    models: path.resolve('./models'),
    controllers: path.resolve('./controllers'),
    views: path.resolve('./views'),
    public: path.resolve('./public'),
    locales: path.resolve('./locales'),
    emails: path.resolve('./services/messaging/email/templates'),
    commands: path.resolve('./commands'),
    migrations: path.resolve('./migrations'),
  },
};
