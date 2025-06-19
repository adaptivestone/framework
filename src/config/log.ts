import type { SentryTransportOptions } from 'winston-transport-sentry-node';
import type { transports } from 'winston';

export type TLogConfig = {
  transports: {
    transport: string;
    transportOptions: {
      level: string;
    } & Record<string, unknown>;
    enable: boolean;
  }[];
};

export default {
  transports: [
    {
      transport: 'winston-transport-sentry-node',
      transportOptions: {
        sentry: {
          dsn: process.env.LOGGER_SENTRY_DSN || process.env.SENTRY_DSN,
        },
        level: process.env.LOGGER_SENTRY_LEVEL || 'info',
      } as SentryTransportOptions,
      enable: process.env.LOGGER_SENTRY_ENABLE || false,
    },
    {
      transport: 'console',
      transportOptions: {
        level: process.env.LOGGER_CONSOLE_LEVEL || 'silly',
        timestamp: true,
      } as transports.ConsoleTransportOptions,
      enable: process.env.LOGGER_CONSOLE_ENABLE || true,
    },
  ],
} as TLogConfig;
