export default {
  port: process.env.HTTP_PORT || 3300,
  hostname: process.env.HTTP_HOST || '0.0.0.0',
  // Allowed CORS origins. Prefer explicit strings (scheme + host), e.g.
  // 'https://app.example.com'. Regexes are matched too — ALWAYS anchor them
  // (`/^https:\/\/([a-z0-9-]+\.)?example\.com$/`), or an unanchored pattern like
  // `/example\.com/` also matches evil-example.com and example.com.attacker.io.
  // `corsDomains: [/./]` reflects EVERY origin — dangerous, dev-only.
  corsDomains: ['http://localhost:3000'],
  myDomain: process.env.HTTP_DOMAIN || 'http://localhost:3300',
  siteDomain: process.env.FRONT_DOMAIN || 'http://localhost:3000',
  // Standard security response headers, applied to every response (set a value
  // to `null` to omit that header). No `helmet` dependency — four headers don't
  // justify one.
  securityHeaders: {
    enabled: true,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    // Off by default: sending HSTS while also serving plain HTTP in local dev
    // causes confusing browser lock-in. Set e.g.
    // 'max-age=31536000; includeSubDomains' when the app is always behind TLS.
    'Strict-Transport-Security': null as string | null,
  },
  // Route matching options. Defaults match Express's lenient behavior; flipping
  // either to `true` is a deliberate, breaking choice for a v6-style strict app.
  routing: {
    caseSensitive: false, // `/Users` matches `/users`
    strictTrailingSlash: false, // `/users/` matches `/users`
  },
  // Limits for multipart/urlencoded request parsing (formidable). Conservative
  // defaults bound unauthenticated uploads (formidable's own defaults allow
  // ~200 MB/file with no cap). Copy this file into your app to raise them, or
  // pass per-mount params to the RequestParser middleware.
  requestParser: {
    maxFileSize: 20 * 1024 * 1024, // 20 MB per file
    maxTotalFileSize: 50 * 1024 * 1024, // 50 MB across all files
    maxFiles: 10,
    maxFields: 1000,
    maxFieldsSize: 2 * 1024 * 1024, // 2 MB of non-file field data
  },
};
