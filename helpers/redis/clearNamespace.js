const redis = require('redis');

async function clearNamespace(conf, keys) {
  const deletedKeys = [];
  const redisClient = redis.createClient({ url: conf.url });

  if (redisClient.isReady) {
    await redisClient.connect();
    if (keys && keys.length > 0) {
      for (const key of keys) {
        deletedKeys.push(redisClient.sendCommand(['del', key]));
      }
      await Promise.all(deletedKeys);
    }

    await redisClient.disconnect();
  }
}

module.exports = clearNamespace;
