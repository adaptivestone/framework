export default {
  hashRounds: 64,
  saltSecret:
    process.env.AUTH_SALT || console.error('AUTH_SALT is not defined'),
  isAuthWithVefificationFlow: true,
};
