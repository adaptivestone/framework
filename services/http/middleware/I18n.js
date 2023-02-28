const i18next = require('i18next');
const BackendFS = require('i18next-fs-backend');
const Backend = require('i18next-chained-backend');

const AbstractMiddleware = require('./AbstractMiddleware');

class I18n extends AbstractMiddleware {
  constructor(app, params) {
    super(app, params);
    const I18NConfig = this.app.getConfig('i18n');
    this.i18n = {
      t: (text) => text,
    };
    if (I18NConfig.enabled) {
      this.logger.info('Enabling i18n support');
      this.i18n = i18next;
      i18next.use(Backend).init({
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
      });
    }

    this.enabled = I18NConfig.enabled;
    this.lookupQuerystring = I18NConfig.lookupQuerystring;
  }

  static get description() {
    return 'Provide language detection and translation';
  }

  async middleware(req, res, next) {
    let { i18n } = this;

    if (this.enabled) {
      const lang = this.detectLang(req);
      i18n = i18next.cloneInstance({ initImmediate: false, lng: lang });
    }

    req.appInfo.i18n = i18n;
    req.i18n = new Proxy(req.appInfo.i18n, {
      get: (target, prop) => {
        this.logger.warn('Please not use "req.i18n" Use "req.appInfo.i18n"');
        return target[prop];
      },
    });

    return next();
  }

  detectors = {
    XLang: (req) => req.get('X-Lang'), // grab from header
    query: (req) => (req.query ? req.query[this.lookupQuerystring] : false), // grab from query
    user: (req) => req.appInfo?.user?.locale, // what if we have a user and user have a defined locale?
  };

  detectorOrder = ['XLang', 'query', 'user'];

  detectLang(req, isUseShortCode = true) {
    let lang = '';
    for (const detectorName of this.detectorOrder) {
      const lng = this.detectors[detectorName](req);
      if (!lng) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (i18next.services.languageUtils.isSupportedCode(lng)) {
        if (isUseShortCode) {
          lang = i18next.services.languageUtils.getLanguagePartFromCode(lng);
        } else {
          lang = lng;
        }
        break;
      }
    }
    return lang;
  }
}

module.exports = I18n;
