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
      (err: Error, _req: Request, res: Response, _next: NextFunction) => {
        // error handling
        console.error(err.stack);
        // TODO
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
