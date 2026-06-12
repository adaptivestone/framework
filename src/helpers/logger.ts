import type winston from 'winston';

const levels = ['error', 'warn', 'info', 'debug'] as const;

type LogLevel = (typeof levels)[number];

/**
 * Silent no-op logger — satisfies the `winston.Logger` shape without
 * constructing one (no transports, no eager init, no winston value import). Used
 * as a non-null fallback when a real logger isn't available, e.g. `Base.logger`
 * reached through a Mongoose model proxy. Covers the log levels + `child` the
 * framework actually calls.
 */
const noop = () => {};
const noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  http: noop,
  verbose: noop,
  debug: noop,
  silly: noop,
  log: noop,
  child() {
    return noopLogger;
  },
} as unknown as winston.Logger;

// Early-boot console logger (before winston exists). The previous level filter
// derived both indexes from the same argument, so it was always true — dropped.
const consoleLogger = (level: LogLevel, message: string) => {
  if (console[level]) {
    console[level](message);
  } else {
    console.log(message);
  }
};

export { consoleLogger, levels, noopLogger };
