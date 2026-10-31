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
import type ThttpConfig from '../../config/http.ts';
import { translateWithDefault } from '../../helpers/translate.ts';
import Base from '../../modules/Base.ts';
import type { IApp, TransformResponseHook } from '../../server.ts';
import type { TI18n } from '../i18n/types.ts';
import {
  builtInErrorHandlers,
  type ErrorHandlerFn,
  type ErrorHandlerResult,
  type ErrorLogLevel,
  errorResultResponse,
  type RegisteredErrorHandler,
  type ResolvedError,
  serverErrorMessage,
  serverErrorResponse,
  toLoggableError,
} from './builtinErrorHandlers.ts';
import { ExpressResponseWriter } from './ExpressResponseWriter.ts';
import Cors from './middleware/Cors.ts';
import I18nMiddleware from './middleware/I18n.ts';
import IpDetector from './middleware/IpDetector.ts';
import PrepareAppInfoMiddleware from './middleware/PrepareAppInfo.ts';
import RequestLoggerMiddleware from './middleware/RequestLogger.ts';
import RequestParserMiddleware from './middleware/RequestParser.ts';
import { HttpResponse } from './responses.ts';
import { createExpressAdapter } from './routing/ExpressAdapter.ts';
import { RouteRegistry } from './routing/RouteRegistry.ts';

export interface FrameworkRequest extends Request {
  appInfo: {
    app: IApp;
    ip?: string | undefined;
    request: Record<string, unknown>;
    query: Record<string, unknown>;
    params: Record<string, unknown>;
    i18n?: TI18n;
  };
}

/**
 * HTTP server based on Express
 */
class HttpServer extends Base {
  express: Express;

  httpServer: Server;

  routeRegistry: RouteRegistry;

  /** Renders route handlers' `HttpResponse` values and the framework's own responses. */
  readonly responseWriter: ExpressResponseWriter;

  /** Consumer-registered error handlers — checked before the built-ins. */
  #errorHandlers: RegisteredErrorHandler[] = [];

  #builtInHandlers: RegisteredErrorHandler[] = builtInErrorHandlers();

  constructor(
    app: IApp,
    options: { transformResponse?: TransformResponseHook } = {},
  ) {
    super(app);
    this.responseWriter = new ExpressResponseWriter({
      transform: options.transformResponse,
      onTransformError: (message) => this.logger?.error(message),
    });
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
        exposedHeaders: httpConfig.corsExposedHeaders,
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
  }

  /**
   * Start accepting connections; resolves once the port is bound. Called by
   * `startServer` after routes, the 404 page and the error handler are
   * mounted, so no request reaches a partly built app.
   */
  listen(): Promise<void> {
    const httpConfig = this.app.getConfig('http') as typeof ThttpConfig;
    return new Promise((resolve) => {
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
          resolve();
        },
      );
    });
  }

  /** Mount the route adapter — single entry to the registry. */
  mountAdapter() {
    this.express.use(
      createExpressAdapter(this.routeRegistry, this.app, this.responseWriter),
    );
  }

  /**
   * Register a handler mapping a thrown error class to an HTTP response.
   * Consumer handlers are checked before the built-ins (`HttpError` mapper,
   * mongoose validation safety net) in registration order — the first
   * `instanceof` match whose handler returns non-null wins; return `null` to
   * pass to the next entry. Typical registration point is the project's
   * `bootHttp` hook. Returns an unregister function.
   *
   * Scope: handlers fire for errors thrown from route handlers, request
   * validation and middleware (the final sink, `addErrorHandler`, resolves
   * through the same registry).
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
   * Resolve a thrown error through the registry: consumer tier first, then
   * built-ins; first `instanceof` match returning non-null wins. A handler
   * that itself throws, or returns a result that is not a valid response,
   * aborts the walk (logged here at `error`; the caller falls through to its
   * 500) — never a crash loop. Returns null when no entry produced a response.
   * `response` is what gets sent; `status`/`body`/`headers` repeat a
   * `{ status, body }` result (for an `HttpResponse` result: its status and
   * JSON body). Called by the route-handler and validation catches and by the
   * final sink, which receives middleware errors.
   */
  async resolveError(
    err: unknown,
    req: FrameworkRequest,
  ): Promise<ResolvedError | null> {
    for (const entry of [...this.#errorHandlers, ...this.#builtInHandlers]) {
      if (err instanceof entry.errorClass) {
        let result: ErrorHandlerResult | HttpResponse | null | undefined;
        let response: HttpResponse | null = null;
        try {
          result = await entry.handler(err, req);
          if (result != null) {
            response = HttpResponse.is(result)
              ? result
              : errorResultResponse(result);
          }
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
        if (response) {
          const legacy = HttpResponse.is(result)
            ? {
                status: response.status,
                body: response.kind === 'json' ? response.body : undefined,
              }
            : (result as ErrorHandlerResult);
          return { ...legacy, response, logLevel: entry.logLevel };
        }
      }
    }
    return null;
  }

  /**
   * Add handle for 404 error
   */
  add404Page() {
    this.express.use((req, res, next) => {
      const notFound = HttpResponse.json(404, {
        message: translateWithDefault(
          req as FrameworkRequest,
          'http.notFound',
          'Not found',
        ),
      });
      return this.responseWriter.write(notFound, req, res).catch(next);
    });
  }

  /**
   * Add the final error sink. A 4-arg handler is the error sink, so it must
   * be registered last. Errors from middleware (and from a handler that
   * already streamed) land here; the registry answers what it recognises,
   * anything else is a 500.
   */
  addErrorHandler() {
    this.express.use(
      async (err: Error, req: Request, res: Response, next: NextFunction) => {
        // If the response already started (e.g. a handler that threw mid-stream),
        // nothing can be sent — hand off to the default finalizer instead of
        // crashing with ERR_HTTP_HEADERS_SENT.
        if (res.headersSent) {
          this.logger?.error(`Unhandled request error: ${err.stack ?? err}`);
          return next(err);
        }
        const frameworkReq = req as FrameworkRequest;
        const resolved = await this.resolveError(err, frameworkReq);
        if (resolved) {
          this.logger?.[resolved.logLevel](toLoggableError(err));
        } else {
          this.logger?.error(`Unhandled request error: ${err.stack ?? err}`);
        }
        try {
          await this.responseWriter.write(
            resolved?.response ?? serverErrorResponse(frameworkReq),
            req,
            res,
          );
        } catch (writeErr) {
          // The error response itself failed (e.g. a body JSON cannot encode):
          // fall back to the plain 500, without the writer or the transform.
          this.logger?.error(
            `Error response could not be written: ${
              writeErr instanceof Error
                ? (writeErr.stack ?? writeErr.message)
                : writeErr
            }`,
          );
          if (!res.headersSent) {
            res.status(500).json({ message: serverErrorMessage(frameworkReq) });
          }
        }
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
