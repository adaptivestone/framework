const http = require('node:http');
const path = require('node:path');
const express = require('express');
const cors = require('cors');

const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');
const BackendFS = require('i18next-fs-backend');
const Backend = require('i18next-chained-backend');
const RequestLoggerMiddleware = require('./middleware/RequestLogger');
const PrepareAppInfoMiddleware = require('./middleware/PrepareAppInfo');
const RequestParserMiddleware = require('./middleware/RequestParser');

const Base = require('../../modules/Base');

/**
 * HTTP server based on Express
 */
class HttpServer extends Base {
  constructor(app) {
    super(app);
    this.express = express();
    this.express.disable('x-powered-by');
    this.express.set('views', [
      this.app.foldersConfig.views,
      path.join(__dirname, '../../views'),
    ]);
    this.express.set('view engine', 'pug');

    this.express.use(new RequestLoggerMiddleware(this.app).getMiddleware());
    this.enableI18N();

    const httpConfig = this.app.getConfig('http');
    this.express.use(
      cors({
        origin: httpConfig.corsDomains,
      }),
    ); // todo whitelist
    this.express.use(express.static(this.app.foldersConfig.public));
    this.express.use(express.static('./public'));

    this.express.use(new PrepareAppInfoMiddleware(this.app).getMiddleware());
    this.express.use(new RequestParserMiddleware(this.app).getMiddleware());

    // As exprress will check numbersof arguments
    // eslint-disable-next-line no-unused-vars
    this.express.use((err, req, res, next) => {
      // error handling
      console.error(err.stack);
      // TODO
      res.status(500).send('Something broke!');
    });

    this.httpServer = http.Server(this.express);

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
   *  Enable support for i18n
   */
  enableI18N() {
    const I18NConfig = this.app.getConfig('i18n');
    if (!I18NConfig.enabled) {
      return;
    }
    const lngDetector = new i18nextMiddleware.LanguageDetector();
    lngDetector.addDetector({
      name: 'xLang',
      // eslint-disable-next-line no-unused-vars
      lookup: (req, res, options) => {
        const lng = req.get('X-Lang');
        if (lng) {
          return lng;
        }
        return false;
      },
      // eslint-disable-next-line no-unused-vars
      cacheUserLanguage: (req, res, lng, options) => {},
    });
    this.logger.info('Enabling i18n support');
    i18next
      .use(Backend)
      .use(lngDetector)
      .init({
        backend: {
          backends: [
            BackendFS,
            //  BackendFS,
          ],
          backendOptions: [
            // {
            //  loadPath: __dirname + '/../../locales/{{lng}}/{{ns}}.json',
            //   addPath: __dirname + '/../../locales/{{lng}}/{{ns}}.missing.json'
            // },
            {
              loadPath: `${this.app.foldersConfig.locales}/{{lng}}/{{ns}}.json`,
              addPath: `${this.app.foldersConfig.locales}/{{lng}}/{{ns}}.missing.json`,
            },
          ],
        },
        fallbackLng: I18NConfig.fallbackLng,
        preload: I18NConfig.preload,
        saveMissing: I18NConfig.saveMissing,
        debug: I18NConfig.debug,
        detection: {
          // caches: ['cookie'],
          order: I18NConfig.langDetectionOders || ['xLang'],
          lookupQuerystring: I18NConfig.lookupQuerystring,
        },
      });
    this.express.use(i18nextMiddleware.handle(i18next));
    this.express.use((req, res, next) => {
      // fix ru-Ru, en-US, etc
      if (res.locals.language.length !== 2) {
        [res.locals.language] = res.locals.language.split('-');
      }
      next();
    });
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

module.exports = HttpServer;
