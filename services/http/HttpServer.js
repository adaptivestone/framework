const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');

const i18next = require('i18next');
const i18nextMiddleware = require('i18next-http-middleware');
const BackendFS = require('i18next-fs-backend');
const Backend = require('i18next-chained-backend');
const PrepareAppInfoMiddleware = require('./middleware/PrepareAppInfo');

const Base = require('../../modules/Base');

/**
 * HTTP server based on Express
 */
class HttpServer extends Base {
  constructor(app, folderConfig) {
    super(app);
    this.express = express();
    this.express.set('views', [
      folderConfig.folders.views,
      path.join(__dirname, '../../views'),
    ]);
    this.express.set('view engine', 'pug');
    this.express.use((req, res, next) => {
      const startTime = Date.now();
      const text = `Request is  [${req.method}] ${req.url}`;
      this.logger.info(text);
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.logger.info(`Finished ${text}. Duration ${duration} ms`);
      });
      next();
    });
    this.enableI18N(folderConfig);

    const httpConfig = this.app.getConfig('http');
    this.express.use(
      cors({
        origin: httpConfig.corsDomains,
      }),
    ); // todo whitelist
    this.express.use(express.urlencoded({ limit: '50mb', extended: true }));
    this.express.use(express.json({ limit: '50mb' }));
    this.express.use(express.static(folderConfig.folders.public));
    this.express.use(express.static('./public'));

    this.express.use(new PrepareAppInfoMiddleware(this.app).getMiddleware());

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
   * @param {object} folderConfig config
   * @param {object} folderConfig.folders folder config
   * @param {string} folderConfig.folders.config path to folder with config files
   * @param {string} folderConfig.folders.models path to folder with moidels files
   * @param {string} folderConfig.folders.controllers path to folder with controllers files
   * @param {string} folderConfig.folders.views path to folder with view files
   * @param {string} folderConfig.folders.public path to folder with public files
   * @param {string} folderConfig.folders.locales path to folder with locales files
   * @param {string} folderConfig.folders.emails path to folder with emails files
   */
  enableI18N(folderConfig) {
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
              loadPath: `${folderConfig.folders.locales}/{{lng}}/{{ns}}.json`,
              addPath: `${folderConfig.folders.locales}/{{lng}}/{{ns}}.missing.json`,
            },
          ],
        },
        fallbackLng: I18NConfig.fallbackLng,
        preload: I18NConfig.preload,
        saveMissing: true,
        debug: false,
        detection: {
          // caches: ['cookie'],
          order: I18NConfig.langDetectionOders || ['xLang'],
          lookupQuerystring: I18NConfig.lookupQuerystring,
        },
      });
    this.express.use(i18nextMiddleware.handle(i18next));
    this.express.use((req, res, next) => {
      // f ix ru-Ru, en-US, etc
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
      res.status(404).render('404');
    });
  }

  static get loggerGroup() {
    return 'service';
  }

  /**
   * Stop http server (mostly for unit testing)
   */
  die() {
    this.httpServer.close();
  }
}

module.exports = HttpServer;
