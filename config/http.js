module.exports = {
  port: process.env.HTTP_PORT || 3300,
  hostname: process.env.HTTP_HOST || '0.0.0.0',
  // if you want to use 'all' domains please copy this file to your app
  // and set "corsDomains: '*'" (not a mistake, string instead of array)
  corsDomains: ['http://localhost:3000'],
  myDomain: process.env.HTTP_DOMAIN || 'http://localhost:3300',
  siteDomain: process.env.FRONT_DOMAIN || 'http://localhost:3000',
};
