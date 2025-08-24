import type { NextFunction, Response } from 'express';
import type i18nConfig from '../../../config/i18n.ts';
import type { IApp } from '../../../server.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';

export type { TI18n };

export interface I18nMiddlewareAppInfo {
  appInfo: {
    i18n: TI18n;
  };
}

class I18n extends AbstractMiddleware {
  enabled = true;

  lookupQuerystring = '';

  constructor(app: IApp, params?: Record<string, unknown>) {
    super(app, params);
    const I18NConfig = this.app.getConfig('i18n') as typeof i18nConfig;
    this.enabled = I18NConfig.enabled;
    this.lookupQuerystring = I18NConfig.lookupQuerystring;
  }

  static get description() {
    return 'Provide language detection and translation';
  }

  async middleware(req: FrameworkRequest, _res: Response, next: NextFunction) {
    let lang = '';

    if (this.enabled) {
      lang = await this.detectLang(req);
    }
    const i18nService = await this.app.getI18nService();

    req.appInfo.i18n = await i18nService.getI18n(lang);
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

  async detectLang(
    req: FrameworkRequest,
    isUseShortCode = true,
  ): Promise<string> {
    let lang = '';
    for (const detectorName of this.detectorOrder) {
      const lng = this.detectors[detectorName](req);
      if (!lng) {
        continue;
      }
      const i18nService = await this.app.getI18nService();
      const i18nInstance = await i18nService.getI18nInstance();
      if (i18nInstance.services.languageUtils.isSupportedCode(lng)) {
        if (isUseShortCode) {
          lang =
            i18nInstance.services.languageUtils.getLanguagePartFromCode(lng);
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
