async function clearNamespace(redisClient, namespace) {
  const deletedKeys = [];

  const keys = await redisClient.sendCommand(['keys', `*${namespace}*`]);

  if (keys && keys.length > 0) {
    for (const key of keys) {
      deletedKeys.push(redisClient.sendCommand(['del', key]));
    }
    await Promise.all(deletedKeys);
  }
}

export default clearNamespace;
