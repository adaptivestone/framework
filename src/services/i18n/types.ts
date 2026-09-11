/** Translation defaults, interpolation values and engine-specific options. */
export interface TranslationOptions {
  defaultValue?: string;
  count?: number;
  context?: string;
  lng?: string;
  ns?: string | string[];
  returnObjects?: boolean;
  returnDetails?: boolean;
  [key: string]: unknown;
}

type StringTranslationOptions = TranslationOptions & {
  returnObjects?: false;
  returnDetails?: false;
};

/** String-key translator; object/detail results must be narrowed by the caller. */
export interface TranslationFunction {
  (key: string | string[], options?: StringTranslationOptions): string;
  (
    key: string | string[],
    defaultValue: string,
    options?: StringTranslationOptions,
  ): string;
  (key: string | string[], options: TranslationOptions): unknown;
  (
    key: string | string[],
    defaultValue: string,
    options: TranslationOptions,
  ): unknown;
}

/** Translator available on requests, including when translations are disabled. */
export type TI18n = { t: TranslationFunction; language: string };

/**
 * Base translation instance. For additional i18next APIs, install its optional
 * peers and assert the returned base instance as `import('i18next').i18n`.
 */
export interface I18nBaseInstance extends TI18n {
  cloneInstance(options?: {
    lng?: string;
    initAsync?: boolean;
  }): I18nBaseInstance;
  services: {
    languageUtils: {
      isSupportedCode(language: string): boolean;
      getLanguagePartFromCode(language: string): string;
    };
  };
}
