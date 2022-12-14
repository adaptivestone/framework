module.exports = {
  enabled: true,
  preload: ['en', 'ru'],
  fallbackLng: 'en',
  saveMissing: false,
  debug: false,
  // https://github.com/i18next/i18next-http-middleware#detector-options
  // in additional we have 'xLang' that detect language based on header 'xLang'
  langDetectionOders: ['xLang'], // from order option
  lookupQuerystring: 'lng', // string to detect language on query
};
