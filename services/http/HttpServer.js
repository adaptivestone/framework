import http from 'node:http';
import path from 'node:path';
import * as url from 'node:url';
import express from 'express';
import RequestLoggerMiddleware from './middleware/RequestLogger.js';
import I18nMiddleware from './middleware/I18n.js';
import PrepareAppInfoMiddleware from './middleware/PrepareAppInfo.js';
import RequestParserMiddleware from './middleware/RequestParser.js';
import Cors from './middleware/Cors.js';
import Base from '../../modules/Base.js';

/**
 * HTTP server based on Express
 */
class HttpServer extends Base {
  constructor(app) {
    super(app);
    this.express = express();
    this.express.disable('x-powered-by');
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    this.express.set('views', [
      this.app.foldersConfig.views,
      path.join(dirname, '../../views'),
    ]);
    this.express.set('view engine', 'pug');

    this.express.use(new PrepareAppInfoMiddleware(this.app).getMiddleware());
    this.express.use(new RequestLoggerMiddleware(this.app).getMiddleware());
    this.express.use(new I18nMiddleware(this.app).getMiddleware());

    const httpConfig = this.app.getConfig('http');
    this.express.use(
      new Cors(this.app, {
        origins: httpConfig.corsDomains,
      }).getMiddleware(),
    );

    this.express.use(new RequestParserMiddleware(this.app).getMiddleware());

    // As exprress will check numbersof arguments
    // eslint-disable-next-line no-unused-vars
    this.express.use((err, req, res, next) => {
      // error handling
      // eslint-disable-next-line no-console
      console.error(err.stack);
      // TODO
      res.status(500).json({ message: 'Something broke!' });
    });

    this.httpServer = http.createServer(this.express);

    const listener = this.httpServer.listen(
      httpConfig.port,
      httpConfig.hostname,
      () => {
        this.logger.info(
          `App started and listening on port ${listener.address().port}`,
        );
        if (+listener.address().port !== +httpConfig.port) {
          // in case we using port 0
          this.app.updateConfig('http', { port: listener.address().port });
          this.logger.info(
            `Updating http config to use new port ${
              listener.address().port
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
