import type { NextFunction, Response } from 'express';
import i18next, { type i18n, type TFunction } from 'i18next';
import BackendFS from 'i18next-fs-backend';
import type i18nConfig from '../../../config/i18n.ts';
import type { IApp } from '../../../server.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';

export type TWithI18n = { t: TFunction; language: string };

class I18n extends AbstractMiddleware {
  cache: { [key: string]: i18n } = {};

  enabled = true;

  lookupQuerystring = '';

  supportedLngs: Array<string> = [];

  fallbackLng = 'en';

  i18n: { t: TFunction; language: string } = {
    t: ((text) => text) as TFunction,
    language: 'en',
  };

  constructor(app: IApp, params?: Record<string, unknown>) {
    super(app, params);
    const I18NConfig = this.app.getConfig('i18n') as typeof i18nConfig;

    if (I18NConfig.enabled) {
      this.logger?.info('Enabling i18n support');
      this.i18n = i18next;
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

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    let i18n;

    if (this.enabled) {
      let lang = this.detectLang(req);
      if (!lang || this.supportedLngs.indexOf(lang) === -1) {
        this.logger?.verbose(
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
    //@ts-expect-error we known thats a new one
    req.i18n = new Proxy(req.appInfo.i18n, {
      get: (target, prop) => {
        this.logger?.warn('Please not use "req.i18n" Use "req.appInfo.i18n"');
        //@ts-expect-error there are should be an erroe
        return target[prop];
      },
    });

    return next();
  }

  detectors: Record<
    string,
    (
      req: FrameworkRequest & GetUserByTokenAppInfo,
    ) => string | undefined | false
  > = {
    XLang: (req: FrameworkRequest) => req.get('X-Lang'), // grab from header
    query: (req: FrameworkRequest) =>
      req.query ? (req.query[this.lookupQuerystring] as string) : false, // grab from query
    user: (req: FrameworkRequest & GetUserByTokenAppInfo) =>
      req.appInfo?.user?.locale, // what if we have a user and user have a defined locale?
  };

  detectorOrder = ['XLang', 'query', 'user'];

  detectLang(req: FrameworkRequest, isUseShortCode = true): string {
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
