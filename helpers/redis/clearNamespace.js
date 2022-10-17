async function clearNamespace(redisClient, keys) {
  const deletedKeys = [];
  if (keys && keys.length > 0) {
    for (const key of keys) {
      deletedKeys.push(redisClient.sendCommand(['del', key]));
    }
    await Promise.all(deletedKeys);
  }
}

module.exports = clearNamespace;
