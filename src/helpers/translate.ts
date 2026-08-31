import type { FrameworkRequest } from '../services/http/HttpServer.ts';

/**
 * Translate a framework message with an in-code English default — the single
 * implementation behind `AbstractMiddleware.translate()` and the HTTP 404/500
 * sinks. The default is the source of truth: it is returned when the request
 * carries no i18n (direct instantiation, i18n disabled), when the key is
 * absent from the app's locales, or when `t()` gives back something that is
 * not a string (malformed resource / `returnObjects`). A present key always
 * wins.
 */
export const translateWithDefault = (
  req: FrameworkRequest,
  key: string,
  defaultValue: string,
): string => {
  const translated = req.appInfo?.i18n?.t(key, { defaultValue });
  return typeof translated === 'string' ? translated : defaultValue;
};
