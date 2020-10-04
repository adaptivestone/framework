module.exports = {
  transports: [
    {
      transport: 'winston-sentry-log',
      transportOptions: {
        dsn: process.env.SENTRY_DSN,
        level: 'info',
      },
      enable: process.env.LOGGER_SENTRY_ENABLE || false,
    },
    {
      transport: 'console',
      transportOptions: {
        level: process.env.LOGGER_CONSOLE_LEVEL || 'silly',
      },
      enable: true,
    },
  ],
};
