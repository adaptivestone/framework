import http from 'node:http';
// import path from 'node:path';
// import * as url from 'node:url';
import express from 'express';
import RequestLoggerMiddleware from './middleware/RequestLogger.ts';
import I18nMiddleware from './middleware/I18n.ts';
import PrepareAppInfoMiddleware from './middleware/PrepareAppInfo.ts';
import RequestParserMiddleware from './middleware/RequestParser.ts';
import IpDetector from './middleware/IpDetector.ts';
import Cors from './middleware/Cors.ts';
import Base from '../../modules/Base.ts';

import type { IApp } from '../../server.ts';
import type { Express, Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { TFunction } from 'i18next';

export interface FrameworkRequest extends Request {
  appInfo: {
    app: IApp;
    ip?: string | undefined;
    request: Record<string, any>;
    query: Record<string, any>;
    // user?: any;
    i18n?: {
      t: TFunction;
      language: string;
    };
    pagination?: {
      page: number;
      limit: number;
      skip: number;
    };
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
      new RequestLoggerMiddleware(this.app).getMiddleware() as any,
    );
    this.express.use(
      new PrepareAppInfoMiddleware(this.app).getMiddleware() as any,
    );
    this.express.use(new IpDetector(this.app).getMiddleware() as any);
    this.express.use(new I18nMiddleware(this.app).getMiddleware() as any);

    const httpConfig = this.app.getConfig('http');
    this.express.use(
      new Cors(this.app, {
        origins: httpConfig.corsDomains,
      }).getMiddleware() as any,
    );

    this.express.use(
      new RequestParserMiddleware(this.app).getMiddleware() as any,
    );

    // As exprress will check numbersof arguments
    // eslint-disable-next-line no-unused-vars
    this.express.use(
      (err: Error, req: Request, res: Response, next: NextFunction) => {
        // error handling
        console.error(err.stack);
        // TODO
        res.status(500).json({ message: 'Something broke!' });
      },
    );

    this.httpServer = http.createServer(this.express);

    const listener = this.httpServer.listen(
      httpConfig.port,
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
    this.express.use((req, res) => {
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
