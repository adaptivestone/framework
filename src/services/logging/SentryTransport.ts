import Transport from 'winston-transport';

/**
 * Winston transport wrapper for Sentry that conditionally loads @sentry/node
 * Assumes Sentry is already initialized in the consuming application
 * Only loads the Winston transport if @sentry/node is installed
 */
class SentryTransport extends Transport {
  private sentryTransport: Transport | null = null;
  private initializationAttempted = false;

  constructor(opts: Transport.TransportStreamOptions = {}) {
    super(opts);

    // Try to load Sentry Winston transport asynchronously
    this.loadSentryTransport(opts);
  }

  private async loadSentryTransport(opts: Transport.TransportStreamOptions) {
    if (this.initializationAttempted) {
      return;
    }
    this.initializationAttempted = true;

    try {
      // Dynamically import @sentry/node/winston - will fail if not installed
      // Using dynamic import to avoid TypeScript errors when package is not installed
      const sentryWinston = await import('@sentry/node/winston' as string);
      const SentryWinstonTransport = sentryWinston.default || sentryWinston;

      // Create the actual Sentry transport
      // Assuming Sentry SDK is already initialized by the consuming application
      this.sentryTransport = new SentryWinstonTransport(opts) as Transport;

      console.log('[Framework] Sentry Winston transport loaded successfully');
    } catch (error) {
      // Sentry is not installed - this is fine for a framework
      console.log(
        '[Framework] Sentry Winston transport not available (package not installed)',
      );
    }
  }

  log(info: unknown, callback: () => void): void {
    // If Sentry transport is loaded, delegate to it
    if (this.sentryTransport && this.sentryTransport.log) {
      this.sentryTransport.log(info, () => {
        callback();
      });
    } else {
      // Otherwise, just call the callback (no-op)
      setImmediate(callback);
    }
  }
}

export default SentryTransport;
