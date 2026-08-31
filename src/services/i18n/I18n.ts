import type { i18n, TFunction } from 'i18next';
import type i18nConfig from '../../config/i18n.ts';
import Base from '../../modules/Base.ts';

export type TI18n = { t: TFunction; language: string };

const MISSING_I18NEXT_MESSAGE =
  'Loading translations requires the optional peer dependencies `i18next` and ' +
  '`i18next-fs-backend`, which are not installed. Add them:\n\n' +
  '  npm i i18next i18next-fs-backend\n\n' +
  'or set `enabled: false` in your `config/i18n.ts` if you do not translate. ' +
  'Framework messages stay English either way.';

/** Thrown when `i18n.enabled` is true but the optional packages are absent. */
class MissingI18nextError extends Error {
  name = 'MissingI18nextError';
}

/**
 * Load the optional i18next packages, mapping a missing install to one clear,
 * actionable error instead of a bare `ERR_MODULE_NOT_FOUND`. Any other failure
 * (a broken install, an i18next-side error) propagates unchanged.
 */
async function loadI18next() {
  try {
    const [{ default: i18next }, { default: BackendFS }] = await Promise.all([
      import('i18next'), // Speed optimisation
      import('i18next-fs-backend'), // Speed optimisation
    ]);
    return { i18next, BackendFS };
  } catch (cause) {
    if ((cause as { code?: string })?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new MissingI18nextError(MISSING_I18NEXT_MESSAGE, { cause });
    }
    throw cause;
  }
}

export class I18n extends Base {
  #cache: { [key: string]: i18n } = {};

  #i18nBase?: i18n;
  #i18nBasePromise?: Promise<i18n>;
  #missingReported = false;

  /**
   * Translator used when i18n is disabled. Honours both i18next default-value
   * overloads (`t(key, 'default')` and `t(key, { defaultValue })`) so framework
   * messages emitted with an in-code English default stay English instead of
   * leaking the raw key. A call with no default keeps returning the key.
   */
  #i18nFallback: { t: TFunction; language: string } = {
    t: ((key, options) =>
      typeof options === 'string'
        ? options
        : (options?.defaultValue ?? key)) as TFunction,
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
      const i18nBase = await this.getI18nBaseInstanceIfAvailable();
      if (!i18nBase) {
        // i18next is not installed: serve the in-code English defaults rather
        // than failing the request. Reported once by the call above.
        return this.#i18nFallback;
      }
      this.#cache[lang] = i18nBase.cloneInstance({
        initAsync: false,
        lng: lang,
      });
    }
    return this.#cache[lang];
  }

  /**
   * Base i18next instance, initialised on first use.
   *
   * @throws when the optional `i18next`/`i18next-fs-backend` packages are not
   * installed — use `getI18nBaseInstanceIfAvailable()` where falling back to
   * the framework's English defaults is the better answer.
   */
  async getI18nBaseInstance() {
    if (this.#i18nBase) {
      return this.#i18nBase;
    }
    if (!this.#i18nBasePromise) {
      this.#i18nBasePromise = (async () => {
        const { i18next, BackendFS } = await loadI18next();
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

  /**
   * Base i18next instance, or `null` when the optional packages are missing —
   * logged once, not per request. Any other initialisation failure still throws.
   */
  async getI18nBaseInstanceIfAvailable(): Promise<i18n | null> {
    try {
      return await this.getI18nBaseInstance();
    } catch (e) {
      if (!(e instanceof MissingI18nextError)) {
        throw e;
      }
      if (!this.#missingReported) {
        this.#missingReported = true;
        this.logger?.warn(e.message);
      }
      return null;
    }
  }

  static get loggerGroup() {
    return 'I18n_';
  }
}
