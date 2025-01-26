/* eslint-disable no-undef */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import redis from 'redis';
import Server from '../server.js';

import clearRedisNamespace from '../helpers/redis/clearNamespace.js';

mongoose.set('autoIndex', false);

let mongoMemoryServerInstance;

jest.setTimeout(1000000);
beforeAll(async () => {
  mongoMemoryServerInstance = await MongoMemoryReplSet.create({
    // binary: { version: '4.4.6' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoMemoryServerInstance.waitUntilRunning();
  process.env.LOGGER_CONSOLE_LEVEL = 'error';
  process.env.AUTH_SALT = randomBytes(16).toString('hex');

  const connectionStringMongo = await mongoMemoryServerInstance.getUri();
  // console.info('MONGO_URI: ', connectionStringMongo);
  global.server = new Server({
    folders: {
      config: process.env.TEST_FOLDER_CONFIG || path.resolve('./config'),
      controllers:
        process.env.TEST_FOLDER_CONTROLLERS || path.resolve('./controllers'),
      views: process.env.TEST_FOLDER_VIEWS || path.resolve('./views'),
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
  await global.server.init({ isSkipModelInit: true });
  global.server.updateConfig('mongo', {
    connectionString: connectionStringMongo,
  });
  global.server.updateConfig('http', { port: 0 }); // allow to use random
  global.server.updateConfig('mail', { transport: 'stub' });
  await global.server.initAllModels();

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
});

beforeEach(() => {
  if (global.server) {
    const key = `test-${Math.random().toString(36).substring(7)}`;
    global.server.app.updateConfig('redis', {
      namespace: key,
    });
  }
});

afterEach(async () => {
  if (global.server) {
    const { url, namespace } = global.server.getConfig('redis');
    const redisClient = redis.createClient({ url });

    try {
      await redisClient.connect();
      await clearRedisNamespace(redisClient, namespace);
      await redisClient.disconnect();
    } catch {
      // that ok. No redis connection
    }
  }
});

afterAll(async () => {
  if (global.server) {
    global.server.app.httpServer.shutdown();
    global.server.app.events.emit('shutdown');
  }

  if (typeof global.testSetup.afterAll === 'function') {
    await global.testSetup.afterAll();
  }

  await mongoose.disconnect();
  await mongoMemoryServerInstance.stop();
});
