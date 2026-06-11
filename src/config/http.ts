export default {
  port: process.env.HTTP_PORT || 3300,
  hostname: process.env.HTTP_HOST || '0.0.0.0',
  // if you want to use 'all' domains please copy this file to your app
  // and set "corsDomains: [/./]
  corsDomains: ['http://localhost:3000'],
  myDomain: process.env.HTTP_DOMAIN || 'http://localhost:3300',
  siteDomain: process.env.FRONT_DOMAIN || 'http://localhost:3000',
  // Limits for multipart/urlencoded request parsing (formidable). Conservative
  // defaults bound unauthenticated uploads (formidable's own defaults allow
  // ~200 MB/file with no cap). Copy this file into your app to raise them, or
  // pass per-mount params to the RequestParser middleware.
  requestParser: {
    maxFileSize: 20 * 1024 * 1024, // 20 MB per file
    maxTotalFileSize: 50 * 1024 * 1024, // 50 MB across all files
    maxFiles: 10,
    maxFields: 1000,
    maxFieldsSize: 2 * 1024 * 1024, // 2 MB of non-file field data
  },
};
