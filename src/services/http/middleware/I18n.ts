import type i18nConfig from '../../../config/i18n.ts';
import type { IApp } from '../../../server.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { Next } from '../RequestContext.ts';
import type { UserContext } from './GetUserByToken.ts';
import Middleware from './Middleware.ts';

export type { TI18n };

export interface I18nMiddlewareAppInfo {
  appInfo: {
    i18n: TI18n;
  };
}

class I18n extends Middleware {
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

  async middleware(ctx: UserContext, next: Next) {
    let lang = '';

    if (this.enabled) {
      lang = await this.detectLang(ctx);
    }
    const i18nService = await this.app.getI18nService();

    ctx.appInfo.i18n = await i18nService.getI18nForLang(lang);
    return next();
  }

  /** Language sources, tried in `detectorOrder`; each reads the request context. */
  detectors: Record<string, (ctx: UserContext) => string | undefined | false> =
    {
      XLang: (ctx) => ctx.header('x-lang'), // grab from header
      query: (ctx) => ctx.query[this.lookupQuerystring] as string, // grab from query
      user: (ctx) => ctx.appInfo.user?.locale, // what if we have a user and user have a defined locale?
    };

  detectorOrder = ['XLang', 'query', 'user'];

  async detectLang(ctx: UserContext, isUseShortCode = true): Promise<string> {
    const { supportedLngs } = this.app.getConfig('i18n') as typeof i18nConfig;
    let lang = '';
    for (const detectorName of this.detectorOrder) {
      const lng = this.detectors[detectorName](ctx);
      // A repeated query parameter arrives as an array — not a language code.
      if (!lng || typeof lng !== 'string') {
        continue;
      }
      const i18nService = await this.app.getI18nService();
      // Null when the optional i18next packages are absent: there is nothing to
      // detect against, so the request falls through to the English defaults.
      const i18nInstance = await i18nService.getI18nBaseInstanceIfAvailable();
      if (!i18nInstance) {
        break;
      }
      const { languageUtils } = i18nInstance.services;
      const languagePart = languageUtils.getLanguagePartFromCode(lng);
      // i18next accepts any code unless it knows `supportedLngs`, so check the
      // configured list too: an unsupported value falls through to the next
      // detector instead of ending detection with the fallback language.
      if (
        languageUtils.isSupportedCode(lng) &&
        supportedLngs.includes(languagePart)
      ) {
        lang = isUseShortCode ? languagePart : lng;
        break;
      }
    }
    return lang;
  }
}

export default I18n;
