export default {
  limiterOptions: {
    // https://github.com/animir/node-rate-limiter-flexible
    // https://github.com/animir/node-rate-limiter-flexible/wiki/Options
    points: 10, // 10 points
    duration: 60, // Per 60 seconds
  },
  driver: 'memory', // can be 'mongo', 'redis'
  consumePoints: 1,
  consumeKeyComponents: {
    ip: true, // include ip to key generation
    route: true, // include route to key generation
    user: true, // include user id to key generation (if user exits)
    request: [], // what should be included from request (req.appInfo.request) if it presented
  },
};
