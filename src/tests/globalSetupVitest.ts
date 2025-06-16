import { MongoMemoryReplSet } from 'mongodb-memory-server';

let isTeardown = false;
let mongoMemoryServerInstance: MongoMemoryReplSet;

const setup = async () => {
  console.log('GLOBAL SETUP PREPARE RUNNING...');
  console.time('GLOBAL TEST PREPARE. DONE');
  mongoMemoryServerInstance = await MongoMemoryReplSet.create({
    // binary: { version: '4.4.6' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoMemoryServerInstance.waitUntilRunning();
  const connectionStringMongo =
    await mongoMemoryServerInstance.getUri('__DB_TO_REPLACE__');
  process.env.TEST_MONGO_URI = connectionStringMongo;
  // console.info('MONGO_URI: ', connectionStringMongo);
  console.timeEnd('GLOBAL TEST PREPARE. DONE');
};

const teardown = async () => {
  if (isTeardown) {
    throw new Error('teardown called twice');
  }
  console.time('GLOBAL TEARDOWN RUNNING. DONE');

  isTeardown = true;
  console.log('GLOBAL TEARDOWN RUNNING...');
  await mongoMemoryServerInstance.stop();
  console.timeEnd('GLOBAL TEARDOWN RUNNING. DONE');

  return Promise.resolve();
};

export { setup, teardown };
