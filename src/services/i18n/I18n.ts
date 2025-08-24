import type { i18n, TFunction } from 'i18next';
import type i18nConfig from '../../config/i18n.ts';
import Base from '../../modules/Base.ts';

export type TI18n = { t: TFunction; language: string };

export class I18n extends Base {
  #cache: { [key: string]: i18n } = {};

  #i18nBase?: i18n;
  #i18nBasePromise?: Promise<i18n>;

  #i18nFallback: { t: TFunction; language: string } = {
    t: ((text) => text) as TFunction,
    language: 'en',
  };

  async getI18nForLang(lang?: string) {
    const i18NConfig = this.app.getConfig('i18n') as typeof i18nConfig;
    if (!i18NConfig.enabled) {
      return this.#i18nFallback;
    }

    if (!lang || i18NConfig.supportedLngs.indexOf(lang) === -1) {
      this.logger?.verbose(
        `Language "${lang}" is not supported or not provided. Using fallback on ${i18NConfig.fallbackLng}`,
      );
      lang = i18NConfig.fallbackLng;
    }
    if (!this.#cache[lang]) {
      this.#cache[lang] = (await this.getI18nBaseInstance()).cloneInstance({
        initAsync: false,
        lng: lang,
      });
    }
    return this.#cache[lang];
  }

  async getI18nBaseInstance() {
    if (this.#i18nBase) {
      return this.#i18nBase;
    }
    if (!this.#i18nBasePromise) {
      this.#i18nBasePromise = (async () => {
        const [{ default: i18next }, { default: BackendFS }] =
          await Promise.all([
            import('i18next'), // Speed optimisation
            import('i18next-fs-backend'), // Speed optimisation
          ]);
        const i18NConfig = this.app.getConfig('i18n') as typeof i18nConfig;

        await i18next.use(BackendFS).init({
          backend: {
            loadPath: `${this.app.foldersConfig.locales}/{{lng}}/{{ns}}.json`,
            addPath: `${this.app.foldersConfig.locales}/{{lng}}/{{ns}}.missing.json`,
          },
          fallbackLng: i18NConfig.fallbackLng,
          preload: i18NConfig.preload,
          saveMissing: i18NConfig.saveMissing,
          debug: i18NConfig.debug,
        });
        this.#i18nBase = i18next;
        return this.#i18nBase;
      })();
    }
    return this.#i18nBasePromise;
  }

  static get loggerGroup() {
    return 'I18n_';
  }
}
