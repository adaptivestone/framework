# Request media-type map (`http.requestParser.mediaTypes`)

## Goal

Parse request bodies whose media type is JSON (or urlencoded) under another
name. The trigger: browsers send CSP `report-uri` violation reports as
`application/csp-report`, a JSON body without "json" in the type, and
`RequestParser` answered them with 400. A consumer asked for the fix in the
framework rather than a workaround in the app (2026-11-14). Ships in 5.6.1.

## Decisions (user, 2026-11-14)

- **A config map, not code.** `config.http.requestParser.mediaTypes` maps a
  media type to a built-in body format. The framework's default `config/http.ts`
  ships `{ 'application/csp-report': 'json' }`; there is no in-code default
  table. An app's own `config/http.ts` replaces the framework's (configs are
  not merged across folders), so such an app adds the entry itself. The README
  upgrade notes and the docs say so.
- **Formats: `'json' | 'urlencoded'` only.** Formidable's built-in plugins test
  the header themselves; `RequestParser` shows the selected plugin its canonical
  media type for the duration of the plugin call. That is safe for the buffered
  formats. Multipart needs the original boundary, and octet-stream records the
  header as the file's `mimetype`, so mapping those would hand handlers
  `application/octet-stream`. Binary and multipart aliases wait for the parser
  registry. The value type can widen later without a break.
- **Resolution order:** an exact `mediaTypes` entry (case-insensitive key, own
  properties only, known format only) wins; then the built-in rules
  (`application/json` and any `+json` → JSON, form → urlencoded,
  `multipart/form-data|related`, `application/octet-stream`); unknown types keep
  the v5 lenient fallback. Mapped bodies are bounded by `maxFieldsSize`.
- **Per-mount params** (`mediaTypes` in RequestParser params) replace the config
  map for that mount, like the other `requestParser` options.
- Route content-type request maps (`request: { '<type>': schema }`) keep keying
  on the real header value; the map does not alias them.

## Relation to the parser registry

The planned `app.parsers.register(contentType, parser)` (v5.1 extras,
`reference/decisions.md`) is the general form. When it lands, its built-in
registrations should be seeded from `requestParser.mediaTypes`, so this config
stays valid.

## Files

- `src/services/http/middleware/RequestParser.ts` — `findBodyFormat`,
  `asMediaType`, selection; `mediaTypes` is kept out of formidable's options.
- `src/config/http.ts` — `requestParser.mediaTypes` with the CSP default.
- `src/services/http/middleware/RequestParser.test.ts` — CSP report via the
  default config, mapped JSON and urlencoded (case-insensitive keys, misleading
  parameters), `maxFieldsSize` on mapped JSON, unlisted/unknown-format/inherited
  keys still 400.
- `CHANGELOG.md` (5.6.1 Added), `README.md` (5.6.1 upgrade notes), docs repo.

## Verification

`RequestParser.test.ts` 24/24; full gates in [release-5.6.1](release-5.6.1.md).
