// this is an optional packages. If @sentry/node is not installed, this transport will be a no-op.

import type { LogSeverityLevel } from '@sentry/core';
import type Sentry from '@sentry/node';
import Transport from 'winston-transport';

// See: https://github.com/winstonjs/triple-beam
const LEVEL_SYMBOL = Symbol.for('level');
const MESSAGE_SYMBOL = Symbol.for('message');
const SPLAT_SYMBOL = Symbol.for('splat');

class ExtendedError extends Error {
  constructor(info: Record<string, unknown>) {
    super((info.message as string) || 'Unknown error');

    this.name = (info.name as string) || 'Error';
    if (info.stack && typeof info.stack === 'string') {
      this.stack = info.stack;
    }
  }
}

function isObject(
  anything: unknown,
): anything is Record<string | symbol, unknown> {
  return typeof anything === 'object' && anything != null;
}
/**
 * Winston transport wrapper for Sentry that conditionally loads @sentry/node
 * Assumes Sentry is already initialized in the consuming application
 * Only loads the Winston transport if @sentry/node is installed
 */
class SentryTransport extends Transport {
  #sentry: Sentry | null = null;
  #initializationAttempted = false;

  constructor(opts: Transport.TransportStreamOptions = {}) {
    super(opts);

    // Try to load Sentry Winston transport asynchronously
    this.loadSentryTransport(opts);
  }

  private async loadSentryTransport(opts: Transport.TransportStreamOptions) {
    if (this.#initializationAttempted) {
      return;
    }
    this.#initializationAttempted = true;

    try {
      // Dynamically import @sentry/node - will fail if not installed
      // Using dynamic import to avoid TypeScript errors when package is not installed
      const SentryNode = await import('@sentry/node' as string);
      const sentry = SentryNode.default || SentryNode;

      this.#sentry = sentry;

      console.log('[Framework] Sentry Winston transport loaded successfully');
    } catch (error) {
      // Sentry is not installed - this is fine for a framework
      console.log(
        '[Framework] Sentry Winston transport not available (package not installed)',
      );
    }
  }

  log(info: unknown, callback: () => void) {
    if (!this.#sentry) {
      setImmediate(callback);
    }
    setImmediate(() => {
      this.emit('logged', info);
    });

    if (!isObject(info)) {
      return;
    }

    const levelFromSymbol = info[LEVEL_SYMBOL];

    // See: https://github.com/winstonjs/winston?tab=readme-ov-file#streams-objectmode-and-info-objects
    const { message, tags, user, ...attributes } = info;
    // Remove all symbols from the remaining attributes
    attributes[LEVEL_SYMBOL] = undefined;
    attributes[MESSAGE_SYMBOL] = undefined;
    attributes[SPLAT_SYMBOL] = undefined;

    const logSeverityLevel =
      WINSTON_LEVEL_TO_LOG_SEVERITY_LEVEL_MAP[levelFromSymbol as string] ??
      'info';

    // Setup Sentry scope with tags, user, and extras
    const scope = this.#sentry.getCurrentScope();
    scope.clear();

    if (tags !== undefined && isObject(tags)) {
      scope.setTags(tags as Record<string, string>);
    }

    if (user !== undefined && isObject(user)) {
      scope.setUser(user as Sentry.User);
    }

    // Filter out undefined values and set extras
    const extras = Object.fromEntries(
      Object.entries(attributes).filter(([_, value]) => value !== undefined),
    );
    scope.setExtras(extras);

    const error =
      Object.values(info).find((value) => value instanceof Error) ??
      new ExtendedError(info as Record<string, unknown>);
    this.#sentry.captureException(error, {
      tags: tags as Record<string, string>,
      level: logSeverityLevel as Sentry.SeverityLevel,
    });
    return callback();
  }
}

const WINSTON_LEVEL_TO_LOG_SEVERITY_LEVEL_MAP: Record<
  string,
  LogSeverityLevel
> = {
  // npm
  silly: 'trace',
  // npm and syslog
  debug: 'debug',
  // npm
  verbose: 'debug',
  // npm
  http: 'debug',
  // npm and syslog
  info: 'info',
  // syslog
  notice: 'info',
  // npm
  warn: 'warn',
  // syslog
  warning: 'warn',
  // npm and syslog
  error: 'error',
  // syslog
  emerg: 'fatal',
  // syslog
  alert: 'fatal',
  // syslog
  crit: 'fatal',
};

export default SentryTransport;
