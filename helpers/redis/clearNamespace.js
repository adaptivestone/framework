const { createClient } = require('redis');

async function clearNamespace(conf) {
  const deletedKeys = [];
  const redisClient = createClient({ url: conf.url });

  if (redisClient) {
    await redisClient.connect();
    const keys = await redisClient.sendCommand(['keys', `${conf.namespace}*`]);

    for (const key of keys) {
      deletedKeys.push(redisClient.sendCommand(['del', key]));
    }
    await Promise.all(deletedKeys);
    await redisClient.disconnect();
  }
}

module.exports = clearNamespace;
