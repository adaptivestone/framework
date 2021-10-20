module.exports = {
  transports: [
    {
      transport: 'winston-transport-sentry-node',
      transportOptions: {
        sentry: {
          dsn: process.env.LOGGER_SENTRY_DSN || process.env.SENTRY_DSN,
        },
        level: process.env.LOGGER_SENTRY_LEVEL || 'info',
      },
      enable: process.env.LOGGER_SENTRY_ENABLE || false,
    },
    {
      transport: 'console',
      transportOptions: {
        level: process.env.LOGGER_CONSOLE_LEVEL || 'silly',
      },
      enable: process.env.LOGGER_CONSOLE_ENABLE || true,
    },
  ],
};
