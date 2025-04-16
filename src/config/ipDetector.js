export default {
  headers: ['X-Forwarded-For'],
  trustedProxy: [
    // list of trusted proxies.
    '169.254.0.0/16', // linklocal
    'fe80::/10', // linklocal
    '127.0.0.1/8', // loopback
    '::1/128', // loopback
    '10.0.0.0/8', // uniquelocal
    '172.16.0.0/12', // uniquelocal
    '192.168.0.0/16', // uniquelocal
    'fc00::/7', // uniquelocal
  ],
};
