export default {
  port: process.env.HTTP_PORT || 3300,
  hostname: process.env.HTTP_HOST || '0.0.0.0',
  // if you want to use 'all' domains please copy this file to your app
  // and set "corsDomains: [/./]
  corsDomains: ['http://localhost:3000'],
  myDomain: process.env.HTTP_DOMAIN || 'http://localhost:3300',
  siteDomain: process.env.FRONT_DOMAIN || 'http://localhost:3000',
};
