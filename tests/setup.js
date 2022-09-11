/* eslint-disable jest/require-top-level-describe */
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoMemoryServerInstance;
const path = require('path');
const Server = require('../server');

const REDIS_NAMESPACE = 'testing:';
const clearRadisNamespace = require('../helpers/redis/clearNamespace');

jest.setTimeout(1000000);
beforeAll(async () => {
  mongoMemoryServerInstance = await MongoMemoryReplSet.create({
    // binary: { version: '4.4.6' },
    replSet: { storageEngine: 'wiredTiger' },
  });
  await mongoMemoryServerInstance.waitUntilRunning();
  process.env.LOGGER_CONSOLE_LEVEL = 'error';
  const connectionStringMongo = await mongoMemoryServerInstance.getUri();
  console.info('MONGO_URI: ', connectionStringMongo);
  global.server = new Server({
    folders: {
      config: process.env.TEST_FOLDER_CONFIG || path.resolve('./config'),
      controllers:
        process.env.TEST_FOLDER_CONTROLLERS || path.resolve('./controllers'),
      views: process.env.TEST_FOLDER_VIEWS || path.resolve('./views'),
      public: process.env.TEST_FOLDER_PUBLIC || path.resolve('./public'),
      models: process.env.TEST_FOLDER_MODELS || path.resolve('./models'),
      emails:
        process.env.TEST_FOLDER_EMAIL ||
        path.resolve('./services/messaging/email/templates'),
      locales: process.env.TEST_FOLDER_LOCALES || path.resolve('./locales'),
      commands: process.env.TEST_FOLDER_COMMANDS || path.resolve('./commands'),
      migrations:
        process.env.TEST_FOLDER_MIGRATIONS || path.resolve('./migrations'),
    },
  });
  global.server.updateConfig('mongo', {
    connectionString: connectionStringMongo,
  });
  global.server.updateConfig('http', { port: 0 }); // allow to use random
  global.server.updateConfig('mail', { transport: 'stub' });
  if (!global.testSetup) {
    global.testSetup = {};
  }
  if (!global.testSetup.disableUserCreate) {
    const User = global.server.app.getModel('User');
    global.user = await User.create({
      email: 'test@test.com',
      password: 'testPassword',
      isVerified: true,
      name: {
        nick: 'testUserNickName',
      },
    }).catch((e) => {
      console.error(e);
      console.info(
        'That error can happens in case you have custom user model. Please use global.testSetup.disableUserCreate flag to skip user creating',
      );
    });
    global.authToken = await global.user.generateToken();
  }
  if (typeof global.testSetup.beforeAll === 'function') {
    await global.testSetup.beforeAll();
  }
  await global.server.startServer();

  process.env.REDIS_NAMESPACE = REDIS_NAMESPACE;
  await clearRadisNamespace(
    {
      url: process.env.REDIS_URI || 'redis://localhost',
      namespace: process.env.REDIS_NAMESPACE || 'main:',
    },
    REDIS_NAMESPACE,
  );
});
afterAll(async () => {
  if (global.server) {
    process.env.REDIS_NAMESPACE = '';
    await clearRadisNamespace(
      {
        url: process.env.REDIS_URI || 'redis://localhost',
        namespace: process.env.REDIS_NAMESPACE || 'main:',
      },
      REDIS_NAMESPACE,
    );
    global.server.app.httpServer.shutdown();
    global.server.app.events.emit('shutdown');
  }
  // setTimeout(async () => {
  if (typeof global.testSetup.afterAll === 'function') {
    await global.testSetup.afterAll();
  }
  await mongoose.disconnect();
  await mongoMemoryServerInstance.stop();
  // }, 2000);
});
