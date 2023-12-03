export default {
  hashRounds: 64,
  saltSecret: process.env.AUTH_SALT || 'gdfg45667_%%^trterte',
  isAuthWithVefificationFlow: true,
};
