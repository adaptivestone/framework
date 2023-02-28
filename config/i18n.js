/**
 * You can use any options from https://www.i18next.com/overview/configuration-options
 */
module.exports = {
  enabled: true,
  preload: ['en', 'ru'],
  supportedLngs: ['en', 'ru'], // should be at least one supported
  fallbackLng: 'en',
  saveMissing: false,
  debug: false,
  lookupQuerystring: 'lng', // string to detect language on query
};
