import type { transports } from 'winston';
import { envBool } from '../helpers/env.ts';

export type TLogConfig = {
  transports: {
    transport: string;
    transportOptions: {
      level: string;
    } & Record<string, unknown>;
    enable: boolean;
  }[];
  /** Field names whose values are replaced before any transport (any depth, any case). */
  redact?: string[];
};

export default {
  transports: [
    {
      transport: 'sentry',
      transportOptions: {
        level: process.env.LOGGER_SENTRY_LEVEL || 'info',
      } as transports.StreamTransportOptions,
      enable: envBool('LOGGER_SENTRY_ENABLE', false),
    },
    {
      transport: 'console',
      transportOptions: {
        level: process.env.LOGGER_CONSOLE_LEVEL || 'silly',
        timestamp: true,
      } as transports.ConsoleTransportOptions,
      enable: envBool('LOGGER_CONSOLE_ENABLE', true),
    },
  ],
  // Log fields whose values are replaced with [REDACTED] before reaching any
  // transport, at any depth and in any letter case. Message text is never
  // rewritten, so pass sensitive values as fields. Your own array replaces
  // this one; keep these names and add yours. `[]` turns redaction off.
  redact: ['authorization', 'cookie', 'password', 'secret', 'token'],
} as TLogConfig;
