import path from 'node:path';
import { beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

const { MongoMemoryReplSet } = require('mongodb-memory-server');

const mongoose = require('mongoose');

let mongoMemoryServerInstance;

const redis = require('redis');
const Server = require('../server');

const clearRedisNamespace = require('../helpers/redis/clearNamespace');

// eslint-disable-next-line vitest/no-hooks, vitest/require-top-level-describe
beforeAll(async () => {
  mongoMemoryServerInstance = await MongoMemoryReplSet.create({
    // binary: { version: '4.4.6' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoMemoryServerInstance.waitUntilRunning();
  process.env.LOGGER_CONSOLE_LEVEL = 'error';
  const connectionStringMongo = await mongoMemoryServerInstance.getUri();
  // console.info('MONGO_URI: ', connectionStringMongo);
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
        process.env.TEST_FOLDER_EMAILS ||
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
  global.server.testingGetUrl = (urlPart) =>
    `http://127.0.0.1:${global.server.getConfig('http').port}${urlPart}`;
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
      // eslint-disable-next-line no-console
      console.error(e);
      // eslint-disable-next-line no-console
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
});

// eslint-disable-next-line vitest/no-hooks, vitest/require-top-level-describe
beforeEach(() => {
  if (global.server) {
    const key = `test-${Math.random().toString(36).substring(7)}`;
    global.server.app.updateConfig('redis', {
      namespace: key,
    });
  }
});

// eslint-disable-next-line vitest/no-hooks, vitest/require-top-level-describe
afterEach(async () => {
  if (global.server) {
    const { url, namespace } = global.server.getConfig('redis');
    const redisClient = redis.createClient({ url });

    try {
      await redisClient.connect();
      await clearRedisNamespace(redisClient, namespace);
      await redisClient.disconnect();
    } catch (err) {
      // that ok. No redis connection
    }
  }
});

// eslint-disable-next-line vitest/no-hooks, vitest/require-top-level-describe
afterAll(async () => {
  if (global.server) {
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
