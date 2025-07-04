import type { Server } from 'node:http';
import http from 'node:http';
import type {
  Express,
  Handler,
  NextFunction,
  Request,
  Response,
} from 'express';
// import path from 'node:path';
// import * as url from 'node:url';
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

export interface FrameworkRequest extends Request {
  appInfo: {
    app: IApp;
    ip?: string | undefined;
    request: Record<string, unknown>;
    query: Record<string, unknown>;
    // user?: any;
    i18n?: {
      t: TFunction;
      language: string;
    };
    // pagination?: {
    //   page: number;
    //   limit: number;
    //   skip: number;
    // };
  };
}

/**
 * HTTP server based on Express
 */
class HttpServer extends Base {
  express: Express;

  httpServer: Server;

  constructor(app: IApp) {
    super(app);
    this.express = express();
    this.express.disable('x-powered-by');

    this.express.use(
      new RequestLoggerMiddleware(this.app).getMiddleware() as Handler,
    );
    this.express.use(
      new PrepareAppInfoMiddleware(this.app).getMiddleware() as Handler,
    );
    this.express.use(new IpDetector(this.app).getMiddleware() as Handler);
    this.express.use(new I18nMiddleware(this.app).getMiddleware() as Handler);

    const httpConfig = this.app.getConfig('http') as typeof ThttpConfig;
    this.express.use(
      new Cors(this.app, {
        origins: httpConfig.corsDomains,
      }).getMiddleware() as Handler,
    );

    this.express.use(
      new RequestParserMiddleware(this.app).getMiddleware() as Handler,
    );

    // As exprress will check numbersof arguments
    this.express.use(
      (err: Error, _req: Request, res: Response, _next: NextFunction) => {
        // error handling
        console.error(err.stack);
        // TODO
        res.status(500).json({ message: 'Something broke!' });
      },
    );

    this.httpServer = http.createServer(this.express);

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

  /**
   * Add handle for 404 error
   */
  add404Page() {
    this.express.use((_req, res) => {
      // error handling
      res.status(404).json({ message: '404' });
    });
  }

  static get loggerGroup() {
    return 'service';
  }

  /**
   * Stop http server (mostly for unit testing)
   */
  shutdown() {
    this.httpServer.close();
  }
}

export default HttpServer;
