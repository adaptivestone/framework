/**
 * Data a shipped email template receives. The email module builds it as
 * `{ locale, t, ...mailConfig.globalVariablesToTemplates, ...templateData }`,
 * so whatever an app adds through those two stays reachable through the index
 * signature.
 */
export type TEmailTemplateData = {
  /** Language the mail is rendered for — the request locale, `en` by default. */
  locale: string;
  /**
   * Translator taken from the request i18n. Always call it with the English
   * text as `defaultValue`: that in-code default is the single English source
   * of truth and holds when the key is missing or i18n is disabled.
   */
  t: (key: string, options?: { defaultValue?: string }) => string;
  /** Link the auth flow asks the user to follow. */
  link: string;
  /** Nickname of the user the mail is about, when they set one. */
  editor?: string | null;
  [key: string]: unknown;
};

/**
 * One file of a template folder (`html`, `subject`, `text`): a module whose
 * default export renders the data into the final string.
 */
export type TEmailTemplate = (data: TEmailTemplateData) => string;
