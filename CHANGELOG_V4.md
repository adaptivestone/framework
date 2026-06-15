# Changelog — v4.x

Archived release notes for the **4.x** major series.
For current releases see [CHANGELOG.md](./CHANGELOG.md).

## [4.11.4] - 2023-12-03

- **[UPDATE]** Deps update.

---

## [4.11.3] - 2023-11-22

- **[UPDATE]** Deps update.

---

## [4.11.2] - 2023-10-29

- **[FIX]** `Cors` middleware return proper headers on multidomains.

---

## [4.11.1] - 2023-10-29

- **[FIX]** `Cors` middleware return proper status.

---

## [4.11.0] - 2023-10-29

- **[NEW]** `Cors` middleware.
- **[BREAKING]** This is a potential breaking change as we switched from `cors` external package to internal middleware. From API nothing was changed. This is a potential breaking changes, but it should keep working as it.

---

## [4.10.0] - 2023-10-28

- **[UPDATE]** Deps update.
- **[NEW]** Static file middleware.
- **[BREAKING]** This is a potential breaking change as we switched from `express.static` to internal middleware that provide less features but faster. From API nothing was changed.

---

## [4.9.2] - 2023-10-09

- **[UPDATE]** Deps update.

---

## [4.9.1] - 2023-10-02

- **[UPDATE]** All responses from framework now happens in JSON. Previouls sometime aswers was in plan text.

---

## [4.9.0] - 2023-09-28

- **[BREAKING]** We are separated testsing to setyp and global setup. Global setup now care of mongo to make sure that only on mongodb memory server is spinned up. If you are using `vitest` please add `"globalSetup": "node_modules/@adaptivestone/framework/tests/globalSetupVitest"` to your vitest config.

---

## [4.8.3] - 2023-09-27

- **[UPDATE]** Fix problme with fat start and closing connections after.

---

## [4.8.2] - 2023-09-21

- **[UPDATE]** CLI - disable mongoose index creation.

---

## [4.8.1] - 2023-09-21

- **[UPDATE]** Model inited on server inited.
- **[NEW]** New options to skip model init `isSkipModelInit`.
- **[NEW]** New method server method `initAllModels()`.

---

## [4.8.0] - 2023-09-21

- **[BREAKING]** Minimum node js version id 18.17.0 now.
- **[BREAKING]** Removed `getFileWithExtendingInhirence`. This was internal method and not suppose to use externally.
- **[UPDATE]** Update `Base.getFilesPathWithInheritance` to use `fs.read` dir resursive option.
- **[UPDATE]** Update cache (refactor+tets).
- **[UPDATE]** Update config and model inits.

---

## [4.7.0] - 2023-09-12

- **[UPDATE]** Update logger init (refactor).
- **[UPDATE]** Updated deps.

---

## [4.6.0] - 2023-09-05

- **[NEW]** Migrated from JEST to `vitest`.

---

## [4.5.0] - 2023-09-05

- **[NEW]** Now `getSuper()` available as a method on mongoose models.
- **[UPDATE]** Update `rate-limiter-flexible` to v3.
- **[UPDATE]** Update test runner to suport ESM. In case problem with test please copy `babel.config.js` from framework to your project directory.

---

## [4.4.0] - 2023-08-27

- **[NEW]** New method to grab url of server it testing enviroument `global.server.testingGetUrl("/some/endpoint")`.

---

## [4.3.1] - 2023-08-27

- **[UPDATE]** `Yup` file validator update. As formidable now return all fields as an array.

---

## [4.3.0] - 2023-08-27

- **[BREAKING]** Updated `formidable` with a new version + tests. Marked as breaking because of a new major version, but this is internal of framework and exernal still the same. Should break nothing.

---

## [4.2.0] - 2023-08-27

- **[UPDATE]** Updated deps.
- **[NEW]** `CreateUser` cli command. Ability to update user by email or id.

---

## [4.1.0] - 2023-08-22

- **[UPDATE]** Updated deps.
- **[NEW]** Email - Ability to render templae to string for future usage.

---

## [4.0.0] - 2023-08-03

- **[BREAKING]** Change `bcrypt` encryption with `scrypt`.
- **[BREAKING]** Change internal express parser to `formidable` parser. Affect you if external `formidable` is used.
- **[BREAKING]** Should not affect any user. Changed `email-templates` module to internal implementation. Idea to keep dependensy list smaller.
- **[BREAKING]** Change `i18n` middleware to internal one. Nothing should be affected.
- **[BREAKING]** Now validation of request splitted between `request` and `query`.
- **[BREAKING]** `supportedLngs` option added to `i18n` config.
- **[BREAKING]** Email inliner now looking for `src/services/messaging/email/resources` folder instead of `build` folder.
- **[BREAKING]** Mongoose v7. <https://mongoosejs.com/docs/migrating_to_7.html>.
- **[BREAKING]** `Yup` validation was updated to v1 <https://github.com/jquense/yup/issues/1906>.
- **[DEPRECATED]** `getExpress` path is deprecated. Renamed to `getHttpPath`.
- **[NEW]** Pagination middleware.
- **[NEW]** `requestLogger` middleware. Migrated from core server to be an middleware.
- **[NEW]** `CreateUser` command.
- **[NEW]** Custom `yup` validator for validate File requests.
- **[UPDATE]** Updated deps.
- **[UPDATE]** `openApi` generator support files.
- **[UPDATE]** Updated `18n` middleware. Introduced internal cachce. Speed up of request processing up to 100%.
- **[UPDATE]** Cache drivers to JSON support `BigInt` numbers.

---

