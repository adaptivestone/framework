/**
 * Escape a value interpolated into the HTML body of an email template. Template
 * modules build markup as plain strings, so the escaping a template language
 * did implicitly has to be explicit here.
 */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
