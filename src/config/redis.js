export default {
  url: process.env.REDIS_URI || 'redis://localhost',
  namespace: process.env.REDIS_NAMESPACE || 'main',
};
