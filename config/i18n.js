module.exports = {
  enabled: true,
  preload: ['en', 'ru'],
  fallbackLng: 'en',
  // https://github.com/i18next/i18next-http-middleware#detector-options
  // in additional we have 'xLang' that detect language based on header 'xLang'
  langDetectionOders: ['xLang'], // from oreder option
  lookupQuerystring: 'lng', // string to detect language on query
};
