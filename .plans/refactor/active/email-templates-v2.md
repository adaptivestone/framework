# email-templates-v2 — shipped templates as JS/TS modules (module-v2 compatible)

**Status**: 🔄 active — module 2.1 half IMPLEMENTED + verified 2026-08-31 (35/35 tests, check/types/build green; js/ts/mjs/cjs engines as plain overridable map entries, fallback-t defaultValue fix, README/CHANGELOG/version 2.1.0), in module working tree pending user review + npm publish. Type note: TMinimalI18n declares only the `{ defaultValue }` options form — a positional string second param provably breaks either i18next TFunction or 2.0-consumer assignability under TS7 strictFunctionTypes (probe matrix in agent report); runtime honours both forms, tested. Framework half waits for module release + 5.4.
**Depends on**: [P1y-bridge](../active/i18n-default-values.md) (defaultValue pattern the templates carry). **Sequencing**: email module 2.1 FIRST, then framework.

## Problem

`framework-module-email` v2 ships engine-less (passthrough `html`/plain only; pug/ejs are consumer-registered via `Mail.registerTemplateEngine`). The framework still ships `src/services/messaging/email/templates/{recovery,verification}/{subject,html,text}.pug` as the defaults the built-in auth flows resolve through `foldersConfig.emails` — so **a consumer on module v2 who triggers recovery/verification without registering a Pug engine gets a render failure, not an email**. Additionally the `verification` templates hardcode Russian strings with no `t()` at all, and passthrough HTML is no fix: templates need interpolation (`link`, `editor`) and i18n.

Proven pattern: insailing converted all 20+ templates to typed TS modules (`default export (data) => string`, shared `_layout.ts`, i18n via `data.t(...)`) plus a 15-line app-registered `ts` engine (dynamic import + call default; app runs TS natively).

## Design

### Email module 2.1 (framework-module-email repo)

- Ship built-in `js` and `ts` module engines: dynamic `import(pathToFileURL(fullPath))`, call default export with the template data, `string | Promise<string>` honoured. Zero new dependencies.
- Built-ins are plain pre-populated entries in the existing `templateEngines` map — **overridable at runtime by construction** (`registerTemplateEngine` is `Map.set`, last wins; `unregister`/`has` already exist). No special-casing; a consumer can replace `js` with a custom invocation contract (named exports, precompiled cache, sandbox).
- `registerTemplateEngine` stays for pug/ejs/handlebars users; insailing can drop its `registerTemplateEngines.ts` boilerplate after upgrading (optional).
- Fix the module's fallback i18n: its dummy is `t: (str) => str` (returns the key), so a `Mail` constructed WITHOUT an i18n object renders framework keys raw even though they carry `defaultValue`. Make it honour both i18next default overloads, mirroring the framework's `#i18nFallback`. (Framework flows always pass `req.appInfo.i18n`, so this only bites direct `new Mailer(app, tpl, data)` consumers — but it must land before the framework templates rely on `t()` everywhere.)

### Framework (this repo)

- Convert the 6 pug files → typed `.ts` template modules; `verification` gets proper English + `t(key, { defaultValue })` (fixes the hardcoded-Russian bug); `recovery` carries its PR 2 keys/defaults forward. Keep it simple — a shared `_layout` only if the two templates genuinely share markup.
- `tsc` compiles them into `dist` as `.js` automatically (they live under `src/`). **Fix `postbuild`**: today it `cp -R src/services/messaging → dist`, which would put raw `.ts` next to compiled `.js` in dist — the module resolves by on-disk extension, so a non-TS-native consumer could dynamic-import the `.ts` and crash. Trim the copy to `resources/` (or drop it if nothing else needs copying); delete the `.pug` files.
- Dev/tests run `src/` natively → module's built-in `ts` engine covers the same files pre-compile.
- App overrides unchanged: `folders.emails` still wins; apps ship `.ts` (native) or `.js` (compiled), same engines.
- Export/document the template-data type so app templates are typed (mirror `TMailBaseData` shape insailing derived).
- Docs note (framework + module): defaults require `framework-module-email >= 2.1`; older module + framework 5.4x defaults = unknown-extension error (same failure as today's pug, so no regression).

### Documentation (docs repo, two stages)

- **With module 2.1**: update `docs/12-email.md` — built-in `js`/`ts`/`mjs`/`cjs` module engines (register-your-own now only for pug/ejs/handlebars), a template-module example (`default export (data) => string`, i18n via `data.t(key, { defaultValue })`), and correct the "t can be a dummy function" note (the dummy honours `defaultValue` since 2.1). Module README is updated in the module repo itself.
- **With the framework half**: rewrite the default-templates story — shipped defaults are compiled JS modules, pug references removed, `folders.emails` override examples switch to module templates, note the `framework-module-email >= 2.1` requirement.

## Out of scope

Template-engine features (layout systems, MJML/react-email) — a template module can already do anything internally. The 4 dead `auth.*` keys were trimmed with the 5.4 riders instead (see [i18n-default-values](i18n-default-values.md)); the `email.verify/emailConfirm/newPassword` key fate still rides here (verification templates decide their keys).

## Done when

Module 2.1: built-in engines land with tests incl. override-wins and async default export; released. Framework: pug gone, `dist` holds compiled `.js` templates only, packaging smoke (or a targeted test) proves a packed consumer with module ≥2.1 renders recovery+verification in English out of the box and an app translation key wins; `npm test`/`check`/`check:types`/`smoke` green; CHANGELOG entries in both repos.
