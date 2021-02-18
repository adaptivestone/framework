/* eslint-disable jest/require-top-level-describe */
const MongodbMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');

let mongoMemoryServerInstance;

const path = require('path');
const Server = require('../server');

beforeAll(async () => {
  jest.setTimeout(50000);
  mongoMemoryServerInstance = new MongodbMemoryServer({
    binary: { version: '4.4.2' },
  });
  process.env.LOGGER_CONSOLE_LEVEL = 'error';

  const connectionStringMongo = await mongoMemoryServerInstance.getUri();
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
    },
  });
  global.server.updateConfig('mongo', {
    connectionString: connectionStringMongo,
  });
  global.server.updateConfig('http', { port: 0 }); // allow to use random
  global.server.updateConfig('mail', { transport: 'stub' });

  if (global.testSetup?.disableUserCreate) {
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

  if (
    global.testSetup?.beforeAll &&
    typeof global.testSetup?.beforeAll === 'function'
  ) {
    await global.testSetup?.beforeAll();
  }

  await global.server.startServer();
});

afterAll(async () => {
  if (global.server) {
    global.server.app.httpServer.die();
  }
  setTimeout(async () => {
    if (
      global.testSetup?.afterAll &&
      typeof global.testSetup?.afterAll === 'function'
    ) {
      await global.testSetup?.afterAll();
    }

    await mongoose.disconnect();
    await mongoMemoryServerInstance.stop();
  }, 500);
});
