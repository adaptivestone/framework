export default {
  hashRounds: 64,
  saltSecret:
    process.env.AUTH_SALT ||
    console.error(
      'AUTH_SALT is not defined. You can "npm run cli generateRandomBytes" and use it',
    ),
  isAuthWithVefificationFlow: true,
};
