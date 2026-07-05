import type { Server } from 'node:http';
import http from 'node:http';
import type {
  Express,
  Handler,
  NextFunction,
  Request,
  Response,
} from 'express';
import express from 'express';
import type { TFunction } from 'i18next';
import type ThttpConfig from '../../config/http.ts';
import Base from '../../modules/Base.ts';
import type { IApp } from '../../server.ts';
import {
  builtInErrorHandlers,
  type ErrorHandlerFn,
  type ErrorHandlerResult,
  type ErrorLogLevel,
  type RegisteredErrorHandler,
} from './builtinErrorHandlers.ts';
import Cors from './middleware/Cors.ts';
import I18nMiddleware from './middleware/I18n.ts';
import IpDetector from './middleware/IpDetector.ts';
import PrepareAppInfoMiddleware from './middleware/PrepareAppInfo.ts';
import RequestLoggerMiddleware from './middleware/RequestLogger.ts';
import RequestParserMiddleware from './middleware/RequestParser.ts';
import { createExpressAdapter } from './routing/ExpressAdapter.ts';
import { RouteRegistry } from './routing/RouteRegistry.ts';

export interface FrameworkRequest extends Request {
  appInfo: {
    app: IApp;
    ip?: string | undefined;
    request: Record<string, unknown>;
    query: Record<string, unknown>;
    i18n?: {
      t: TFunction;
      language: string;
    };
  };
}

/**
 * HTTP server based on Express
 */
class HttpServer extends Base {
  express: Express;

  httpServer: Server;

  routeRegistry: RouteRegistry;

  /** Consumer-registered error handlers — checked before the built-ins. */
  #errorHandlers: RegisteredErrorHandler[] = [];

  #builtInHandlers: RegisteredErrorHandler[] = builtInErrorHandlers();

  constructor(app: IApp) {
    super(app);
    this.express = express();
    this.express.disable('x-powered-by');
    this.routeRegistry = new RouteRegistry();

    const httpConfig = this.app.getConfig('http') as typeof ThttpConfig;

    // Security headers first, so every response path (routes, 404, 405, errors)
    // carries them. The header list is precomputed; `enabled` is re-read per
    // request so it can be toggled via config without a reboot.
    const securityHeaderEntries = Object.entries(
      httpConfig.securityHeaders ?? {},
    ).filter(
      ([key, value]) => key !== 'enabled' && typeof value === 'string',
    ) as [string, string][];
    this.express.use((_req, res, next) => {
      const securityHeaders = (this.app.getConfig('http') as typeof ThttpConfig)
        .securityHeaders;
      if (securityHeaders?.enabled) {
        for (const [name, value] of securityHeaderEntries) {
          res.setHeader(name, value);
        }
      }
      next();
    });

    this.express.use(
      new RequestLoggerMiddleware(this.app).getMiddleware() as Handler,
    );
    this.express.use(
      new PrepareAppInfoMiddleware(this.app).getMiddleware() as Handler,
    );
    this.express.use(new IpDetector(this.app).getMiddleware() as Handler);
    this.express.use(new I18nMiddleware(this.app).getMiddleware() as Handler);

    this.express.use(
      new Cors(this.app, {
        origins: httpConfig.corsDomains,
      }).getMiddleware() as Handler,
    );

    this.express.use(
      new RequestParserMiddleware(this.app).getMiddleware() as Handler,
    );

    this.httpServer = http.createServer(this.express);

    // A server that can't bind (EADDRINUSE / EACCES) has no purpose: exit so a
    // supervisor restarts it, instead of lingering as a healthy-looking process
    // serving nothing. Without this listener the 'error' would surface as an
    // uncaughtException (only logged) — a silent dead process.
    this.httpServer.on('error', (err) => {
      this.logger?.error(`HTTP server failed to start: ${err}`);
      process.exit(1);
    });

    const listener = this.httpServer.listen(
      httpConfig.port as number,
      httpConfig.hostname,
      () => {
        const address = listener.address();
        const port = typeof address === 'string' ? 0 : address?.port || 0;
        this.logger?.info(`App started and listening on port ${port}`);
        if (+port !== +httpConfig.port) {
          // in case we using port 0
          this.app.updateConfig('http', { port });
          this.logger?.info(
            `Updating http config to use new port ${
              port
            }. Old was ${httpConfig.port} `,
          );
        }
      },
    );
  }

  /** Mount the route adapter — single entry to the registry. */
  mountAdapter() {
    this.express.use(createExpressAdapter(this.routeRegistry, this.app));
  }

  /**
   * Register a handler mapping a thrown error class to an HTTP response.
   * Consumer handlers are checked before the built-ins (`HttpError` mapper,
   * mongoose validation safety net) in registration order — the first
   * `instanceof` match whose handler returns non-null wins; return `null` to
   * pass to the next entry. Typical registration point is the project's
   * `bootHttp` hook. Returns an unregister function.
   */
  registerErrorHandler<E extends Error>(
    errorClass: abstract new (...args: never[]) => E,
    handler: ErrorHandlerFn<E>,
    opts?: { logLevel?: ErrorLogLevel },
  ): () => void {
    const entry: RegisteredErrorHandler = {
      errorClass,
      // Stored type-erased; `resolveError` guarantees `instanceof errorClass`
      // before the call, so the narrower parameter type is safe.
      handler: handler as ErrorHandlerFn,
      logLevel: opts?.logLevel ?? 'warn',
    };
    this.#errorHandlers.push(entry);
    return () => {
      const i = this.#errorHandlers.indexOf(entry);
      if (i !== -1) {
        this.#errorHandlers.splice(i, 1);
      }
    };
  }

  /**
   * Resolve a handler-thrown error through the registry: consumer tier first,
   * then built-ins; first `instanceof` match returning non-null wins. A
   * handler that itself throws aborts the walk (logged here at `error`; the
   * caller falls through to its 500) — never a crash loop. Returns null when
   * no entry produced a response.
   */
  async resolveError(
    err: unknown,
    req: FrameworkRequest,
  ): Promise<(ErrorHandlerResult & { logLevel: ErrorLogLevel }) | null> {
    for (const entry of [...this.#errorHandlers, ...this.#builtInHandlers]) {
      if (err instanceof entry.errorClass) {
        let result: ErrorHandlerResult | null | undefined;
        try {
          result = await entry.handler(err, req);
        } catch (handlerErr) {
          // Keep the stack — a broken consumer handler is exactly the case
          // where `${err}` (message-only) isn't enough to debug.
          this.logger?.error(
            `Error handler for ${entry.errorClass.name} threw: ${
              handlerErr instanceof Error
                ? (handlerErr.stack ?? handlerErr.message)
                : handlerErr
            }`,
          );
          return null;
        }
        if (result != null) {
          return { ...result, logLevel: entry.logLevel };
        }
      }
    }
    return null;
  }

  /**
   * Add handle for 404 error
   */
  add404Page() {
    this.express.use((_req, res) => {
      // error handling
      res.status(404).json({ message: '404' });
    });
  }

  /**
   * Add the 500 error handler. Express recognises 4-arg middleware as the
   * error sink, so it must be registered last.
   */
  addErrorHandler() {
    this.express.use(
      (err: Error, _req: Request, res: Response, next: NextFunction) => {
        this.logger?.error(`Unhandled request error: ${err.stack ?? err}`);
        // If the response already started (e.g. a handler that threw mid-stream),
        // we can't set a 500 — hand off to Express's default finalizer instead
        // of crashing with ERR_HTTP_HEADERS_SENT.
        if (res.headersSent) {
          return next(err);
        }
        res.status(500).json({ message: 'Something broke!' });
      },
    );
  }

  static get loggerGroup() {
    return 'service';
  }

  /**
   * Stop the HTTP server: refuse new connections and resolve once in-flight
   * requests have drained, so a caller can await the drain before downstream
   * resources (mongo, redis) are torn down.
   */
  shutdown(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.close(() => resolve());
      // Idle keep-alive sockets would otherwise hold the drain open until the
      // client/LB times out; active requests still finish.
      this.httpServer.closeIdleConnections();
    });
  }
}

export default HttpServer;
