import i18next from 'i18next';
import BackendFS from 'i18next-fs-backend';
import AbstractMiddleware from './AbstractMiddleware.js';

class I18n extends AbstractMiddleware {
  cache = {};

  enabled = true;

  lookupQuerystring = '';

  supportedLngs = [];

  fallbackLng = 'en';

  /** @type {i18next} */
  i18n = {
    // @ts-ignore
    t: (text) => text,
    language: 'en',
  };

  constructor(app, params) {
    super(app, params);
    const I18NConfig = this.app.getConfig('i18n');

    if (I18NConfig.enabled) {
      this.logger.info('Enabling i18n support');
      this.i18n = i18next;
      // eslint-disable-next-line import-x/no-named-as-default-member
      i18next.use(BackendFS).init({
        backend: {
          loadPath: `${this.app.foldersConfig.locales}/{{lng}}/{{ns}}.json`,
          addPath: `${this.app.foldersConfig.locales}/{{lng}}/{{ns}}.missing.json`,
        },
        fallbackLng: I18NConfig.fallbackLng,
        preload: I18NConfig.preload,
        saveMissing: I18NConfig.saveMissing,
        debug: I18NConfig.debug,
      });
    }

    this.enabled = I18NConfig.enabled;
    this.lookupQuerystring = I18NConfig.lookupQuerystring;
    this.supportedLngs = I18NConfig.supportedLngs;
    this.fallbackLng = I18NConfig.fallbackLng;
  }

  static get description() {
    return 'Provide language detection and translation';
  }

  async middleware(req, res, next) {
    let i18n;

    if (this.enabled) {
      let lang = this.detectLang(req);
      if (!lang || this.supportedLngs.indexOf(lang) === -1) {
        this.logger.verbose(
          `Language "${lang}" is not supported or not detected. Using fallback on ${this.fallbackLng}`,
        );
        lang = this.fallbackLng;
      }

      if (!this.cache[lang]) {
        this.cache[lang] = i18next.cloneInstance({
          initAsync: false,
          lng: lang,
        });
      }
      i18n = this.cache[lang];
    }

    if (!i18n) {
      i18n = this.i18n;
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

export default I18n;
