# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0-next]

This is a big release that contains a lot of new features and breaking changes.
Main feature of that release is full TypeScript support insluding mongoose models.

### New Features

- **[NEW]** Full TypeScript support, including Mongoose models.
- **[NEW]** New model type: `BaseModel`, simplifying work with TypeScript and based on statics.
- **[NEW]** `AppInstance` helper to access the app instance from anywhere without passing it.
- **[NEW]** `GenerateTypes` command added.
- **[NEW]** `Lock` model for working with locks via MongoDB.
- **[NEW]** `FrameworkFolder` folder added to the app for module usage.
- **[NEW]** Ability to skip Mongo model initialization in CLI environments.
- **[NEW]** Mongo connections in CLI now have unique names, including the command name.
- **[NEW]** On shutdown event, force shutdown after a timeout.
- **[NEW]** `GenerateRandomBytes` command added.
- **[NEW]** `IpDetector` middleware for detecting proxies and `X-Forwarded-For` headers.
- **[NEW]** Test helpers getTestServerURL and serverInstance.

### Breaking changes (please read carefully)

- **[BREAKING]** No more global variables for testing and default user will not be created by default
- **[BREAKING]** All models now should be extended from `BaseModel`. This is a potencial breaking change specially for `User` model.
- **[BREAKING]** Remove jest support for testing.
- **[BREAKING]** Move email module to separate package `@adaptivestone/framework-module-email`. Please use it if you want to send emails.
- **[BREAKING]** Remove `VIEWS` folders at all. Should not affect any user as this was not used internally.
- **[BREAKING]** Removed `noidemailer-sendmail-transport`. Not needed anymore and not recommended to use as well.
- **[BREAKING]** Remove `minimist` CLI parsing and replace it by `commandArguments` parser.
- **[BREAKING]** `vitest` v3 <https://vitest.dev/guide/migration.html>.
- **[BREAKING]** `i18next` v24 <https://www.i18next.com/misc/migration-guide#v23.x.x-to-v24.0.0>.
- **[BREAKING]** Possible breaking. Framework start using express 5 instead of express 4. Please follow express migration guide too <https://expressjs.com/en/guide/migrating-5.html>.
- **[BREAKING]** As part of express 5 migration `_` in rotes (middlewares) should have perameter. please replace `_` to `*splat`.
- **[BREAKING]** Default auth responce changed to be unified. `{token, user}` => `{data:{token, user}}`.
- **[BREAKING]** `RateLimiter` now need to have `IpDetector` middleware before.
- **[BREAKING]** Removing `staticFiles` middleware as it not used in projects anymore. Docs with nginx config will be provided.
- **[BREAKING]** Remove default `AUTH_SALT`. It should be provided on a app level now.
- **[BREAKING]** Minimum node version is 20.12 as for now (`process.loadEnvFile`).
- **[BREAKING]** ESM only. No more commonJS. That help to fix a lot of bugs with tests and provides better development expirience.
- **[BREAKING]** Mongoose v8. <https://mongoosejs.com/docs/migrating_to_8.html>.

---

## [5.0.0-beta.24]

- **[UPDATE]** Update types.

---

## [5.0.0-beta.23]

- **[BREAKING]** No more global variables for testing and default user will not be created by default
- **[NEW]** Test helpers getTestServerURL, serverInstance, setDefaultUser, setDefaultAuthToken and createDefaultTestUser.

---

## [5.0.0-beta.22]

- **[UPDATE]** Update types.

---

## [5.0.0-beta.21]

- **[FIX]** Fix bug with missed model options.

---

## [5.0.0-beta.20]

- **[FIX]** Fix bug with `Lock` model index.
- **[NEW]** `BaseModel` add `Virtuals`.

---

## [5.0.0-beta.19]

- **[NEW]** Introducing new model type. `BaseModel`. Features - simplifie works with typescript. And based on statics.
- **[BREAKING]** All models now should be extended from `BaseModel`. This is a potencial breaking change specially for `User` model.

---

## [5.0.0-beta.18]

- **[UPDATE]** Move away connection from `mongooseModels` to server itself (preparation for different model types).
- **[BREAKING]** Potencial. We are removed callback from `mongooseModels` contrctuctor. It was not used in code.
- **[NEW]** Add `appInstance` helper to access app instance from anywhere without passing it.

---

## [5.0.0-beta.17]

- **[NEW]** Add `GenerateTypes` command.

---

## [5.0.0-beta.16]

- **[UPDATE]** Update deps.
- **[UPDATE]** New app getter `internalFilesCache`.
- **[UPDATE]** Command new static props to load `isShouldGetModelPaths`.

---

## [5.0.0-beta.15]

- **[FIX]** Fix missing folder `migrations` in `dist` folder (hope that will be finally).

---

## [5.0.0-beta.14]

- **[FIX]** Fix missing folder `migrations` in `dist` folder.

---

## [5.0.0-beta.13]

- **[UPDATE]** Only process `.ts` or `.js` files (not `.map` files).

---

## [5.0.0-beta.12]

- **[BREAKING]** Remove jest support for testing.
- **[NEW]** Initial move to typescript. Potencially breaking.
- **[NEW]** Introduce `src` and `dist` folders.

---

## [5.0.0-beta.11]

- **[NEW]** Commands typing.
- **[NEW]** Commands support TS files.
- **[UPDATE]** Update deps.

---

## [5.0.0-beta.9]

- **[BREAKING]** Move email module to separate package `@adaptivestone/framework-module-email`. Please use it if you want to send emails.
- **[NEW]** App now contains `frameworkFolder` folder the framework located. Mostly for modules usage.
- **[BREAKING]** Remove `VIEWS` folders at all. Should not afffect any user as this was not used internally.
- **[UPDATE]** Update typing.
- **[UPDATE]** Change `redis` -> `@redis/client` as we are using only client from pakage.
- **[BREAKING]** Removed `noidemailer-sendmail-transport`. Not needed anymore and not recommended to use as well.

---

## [5.0.0-beta.8]

- **[UPDATE]** Update deps.
- **[NEW]** `Lock` model for working locks via mongoDB.

---

## [5.0.0-beta.7]

- **[UPDATE]** Update deps.
- **[UPDATE]** Change `vitest` shutdown behavior as mongo driver v6.13 change befaviur that affect us (`MongoClient.close` now closes any outstanding cursors).

---

## [5.0.0-beta.5]

- **[BREAKING]** Remove `minimist` CLI parsing and replace it by `commandArguments` parser.
- **[UPDATE]** Migrated from `eslint-plugin-import` to `eslint-plugin-import-x`.
- **[UPDATE]** Migrate to eslint 9 and away from aibnb styles (they are abonded).

---

## [5.0.0-beta.4]

- **[NEW]** On shutdown event now after timeout we are forcing to shutdown.

---

## [5.0.0-beta.2]

- **[UPDATE]** Update deps.
- **[NEW]** Add ability to skip mongo model init in CLI env.
- **[NEW]** Now each mongo connection on CLI have own name and inslude command name there too (`getMongoConnectionName` in command).

---

## [5.0.0-beta.1]

- **[UPDATE]** Update deps.
- **[BREAKING]** `vitest` v3 <https://vitest.dev/guide/migration.html>.

---

## [5.0.0-alpha.26]

- **[UPDATE]** Update deps.
- **[UPDATE]** New commands view in CLI.

---

## [5.0.0-alpha.24]

- **[UPDATE]** Update deps.
- **[BREAKING]** `i18next` v24 <https://www.i18next.com/misc/migration-guide#v23.x.x-to-v24.0.0>.

---

## [5.0.0-alpha.23]

- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.22]

- **[UPDATE]** Update deps.
- **[FIX]** Fix optional routing parameters.

---

## [5.0.0-alpha.21]

- **[BREAKING]** Possible breaking. Framework start using express 5 instead of express 4. Please follow express migration guide too <https://expressjs.com/en/guide/migrating-5.html>.
- **[BREAKING]** As part of express 5 migration `_` in rotes (middlewares) should have perameter. please replace `_` to `*splat`.
- **[UPDATE]** Update deps.
- **[UPDATE]** Mailer uses `await import()` for startup speedup.

---

## [5.0.0-alpha.20]

- **[UPDATE]** Update deps.
- **[UPDATE]** `#realLogger` do not throw error in a scecific cases (`model.toJSON({virtual:true})`).

---

## [5.0.0-alpha.19]

- **[NEW]** Added `modelSchemaOptions` for models.

---

## [5.0.0-alpha.18]

- **[BREAKING]** Default auth responce changed to be unified. `{token, user}` => `{data:{token, user}}`.
- **[UPDATE]** `RateLimiter` updae key generation.

---

## [5.0.0-alpha.17]

- **[NEW]** `generateRandomBytes` command.
- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.16]

- **[UPDATE]** No warning of direct usage `body` and `query`.
- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.15]

- **[BUG]** Fix bug with pagination.
- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.14]

- **[NEW]** Add types for `Abstract` model (wip).

---

## [5.0.0-alpha.13]

- **[UPDATE]** Update deps.
- **[UPDATE]** Update `i18n` internal implementation.
- **[CHANGE]** Disable https server view.

---

## [5.0.0-alpha.12]

- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.11]

- **[UPDATE]** Update deps.

---

## [5.0.0-alpha.10]

- **[UPDATE]** Update deps.
- **[NEW]** `IpDetector` middleware that support detecting proxy and `X-Forwarded-For` header.
- **[BREAKING]** `RateLimiter` now need to have `IpDetector` middleware before.

---

## [5.0.0-alpha.9]

- **[UPDATE]** Update deps.
- **[BREAKING]** Removing `staticFiles` middleware as it not used in projects anymore. Docs with nginx config will be provided.
- **[BREAKING]** Remove default `AUTH_SALT`. It should be provided on a app level now.
- **[BREAKING]** Vitest 2.0.0 <https://vitest.dev/guide/migration.html#migrating-to-vitest-2-0>.

---

## [5.0.0-alpha.8]

- **[UPDATE]** Replace `dotenv` with `loadEnvFile`.
- **[UPDATE]** Replace `nodemon` with `node --watch` (dev only).
- **[BREAKING]** Minimum node version is 20.12 as for now (`process.loadEnvFile`).

---

## [5.0.0-alpha.7]

- **[UPDATE]** Deps update.

---

## [5.0.0-alpha.6]

- **[UPDATE]** Update internal documentation (`jsdoc`, `d.ts`).

---

## [5.0.0-alpha.5]

- **[UPDATE]** More verbose errors for rapsing body request.
- **[UPDATE]** Deps update.

---

## [5.0.0-alpha.4]

- **[UPDATE]** Update `rate-limiter-flexible` to v5.
- **[CHANGE]** Cache update `redis.setEX` to `redis.set(..,..,{EX:xx})` as `setEX` deprecated.

---

## [5.0.0-alpha.3]

- **[UPDATE]** Deps update.
- **[FIX]** `Migration` commands apply.

---

## [5.0.0-alpha.2]

- **[UPDATE]** Deps update.

---

## [5.0.0-alpha.1]

- **[BREAKING]** Vitest 1.0.0 <https://vitest.dev/guide/migration.html#migrating-from-vitest-0-34-6>.
- **[BREAKING]** ESM only. No more commonJS. That help to fix a lot of bugs with tests and provides better development expirience.
- **[BREAKING]** Mongoose v8. <https://mongoosejs.com/docs/migrating_to_8.html>.

---

## [4.11.4]

- **[UPDATE]** Deps update.

---

## [4.11.3]

- **[UPDATE]** Deps update.

---

## [4.11.2]

- **[FIX]** `Cors` middleware return proper headers on multidomains.

---

## [4.11.1]

- **[FIX]** `Cors` middleware return proper status.

---

## [4.11.0]

- **[NEW]** `Cors` middleware.
- **[BREAKING]** This is a potencial breaking change as we switched from `cors` external package to internal middleware. From API nothing was changed. This is a potencial breaking changes, but it should keep working as it.

---

## [4.10.0]

- **[UPDATE]** Deps update.
- **[NEW]** Static file middleware.
- **[BREAKING]** This is a potencial breaking change as we switched from `express.static` to internal middleware that provide less features but faster. From API nothing was changed.

---

## [4.9.2]

- **[UPDATE]** Deps update.

---

## [4.9.1]

- **[UPDATE]** All responces from framework now happens in JSON. Previouls sometime aswers was in plan text.

---

## [4.9.0]

- **[BREAKING]** We are separated testsing to setyp and global setup. Global setup now care of mongo to make sure that only on mongodb memoery server is spinned up. If you are using `vitest` please add `"globalSetup": "node_modules/@adaptivestone/framework/tests/globalSetupVitest"` to your vitest config.

---

## [4.8.3]

- **[UPDATE]** Fix problme with fat start and closing connections after.

---

## [4.8.2]

- **[UPDATE]** CLI - disable mongoose index creation.

---

## [4.8.1]

- **[UPDATE]** Model inited on server inited.
- **[NEW]** New options to skip model init `isSkipModelInit`.
- **[NEW]** New method server method `initAllModels()`.

---

## [4.8.0]

- **[BREAKING]** Minimum node js version id 18.17.0 now.
- **[BREAKING]** Removed `getFileWithExtendingInhirence`. This was internal method and not suppose to use externally.
- **[UPDATE]** Update `Base.getFilesPathWithInheritance` to use `fs.read` dir resursive option.
- **[UPDATE]** Update cache (refactor+tets).
- **[UPDATE]** Update config and model inits.

---

## [4.7.0]

- **[UPDATE]** Update logger init (refactor).
- **[UPDATE]** Updated deps.

---

## [4.6.0]

- **[NEW]** Migrated from JEST to `vitest`.

---

## [4.5.0]

- **[NEW]** Now `getSuper()` available as a method on mongoose models.
- **[UPDATE]** Update `rate-limiter-flexible` to v3.
- **[UPDATE]** Update test runner to suport ESM. In case problem with test please copy `babel.config.js` from framework to your project directory.

---

## [4.4.0]

- **[NEW]** New method to grab url of server it testing enviroument `global.server.testingGetUrl("/some/endpoint")`.

---

## [4.3.1]

- **[UPDATE]** `Yup` file validator update. As formidable now return all fields as an array.

---

## [4.3.0]

- **[BREAKING]** Updated `formidable` with a new version + tests. Marked as breaking because of a new major version, but this is internal of framework and exernal still the same. Should break nothing.

---

## [4.2.0]

- **[UPDATE]** Updated deps.
- **[NEW]** `CreateUser` cli command. Ability to update user by email or id.

---

## [4.1.0]

- **[UPDATE]** Updated deps.
- **[NEW]** Email - Ability to render templae to string for future usage.

---

## [4.0.0]

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

## [3.4.3]

- **[UPDATE]** Updated deps.
- **[FIX]** Fix tests for redis.
- **[FIX]** Support in tests `TEST_FOLDER_EMAILS`.

---

## [3.4.2]

- **[UPDATE]** Updated deps.
- **[FIX]** Fix documentation generation.

---

## [3.4.1]

- **[FIX]** Fix documentation generation.

---

## [3.4.0]

- **[NEW]** Now we pass `req` to validation and casting as a second parameter. This done mostly for custom validators.

---

## [3.3.0]

- **[NEW]** New command `SyncIndexes` to sync indexes for mongodb <https://framework.adaptivestone.com/docs/cli#syncindexes>.
- **[UPDATE]** Updated deps.
- **[FIX]** Fix documentation generation.

---

## [3.2.2]

- **[UPDATE]** Add options for `i18n` to config.
- **[CHANGE]** By default `i18n` not writing missed keys. Can be enabled via config.

---

## [3.2.1]

- **[UPDATE]** Updated deps.
- **[FIX]** Fix documentation generation.

---

## [3.2.0]

- **[UPDATE]** Updated deps.
- **[NEW]** `cache.removeKey(key)` - function to remove key from cache.

---

## [3.1.1]

- **[UPDATE]** Updated deps.
- **[FIX]** Fix cache error handling.

---

## [3.1.0]

- **[NEW]** New comand to generate open API documentation (wip).
- **[NEW]** Coverage report.
- **[UPDATE]** Updated deps.

---

## [3.0.23]

- **[UPDATE]** Updated deps.
- **[FIX]** Fix custom errors.

---

## [3.0.22]

- **[UPDATE]** Updated deps.
- **[UPDATE]** Cast function now can be ASYNC too.

---

## [3.0.21]

- **[UPDATE]** Updated redis to v4.
- **[NEW]** Updates tests to have own namespace on redis.

---

## [3.0.20]

- **[UPDATE]** Update deps.

---

## [3.0.19]

- **[UPDATE]** Update deps.

---

## [3.0.18]

- **[UPDATE]** Update deps.
- **[UPDATE]** Change default branch to `main`.

---

## [3.0.17]

- **[UPDATE]** Update deps.

---

## [3.0.16]

- **[UPDATE]** Update deps.
- **[FIX]** Fix bug with route level middleware.

---

## [3.0.15]

- **[UPDATE]** Update deps.
- **[UPDATE]** Minimum node version 16.

---

## [3.0.14]

- **[NEW]** Now possible to show all errors during validation (default one) by parameter `controllerValidationAbortEarly`.
- **[UPDATE]** Update deps.

---

## [3.0.13]

- **[UPDATE]** Bug fix with "mergeParams".

---

## [3.0.12]

- **[NEW]** Ability to pass "mergeParams" options to express router.
- **[UPDATE]** Update deps.

---

## [3.0.11]

- **[UPDATE]** More verbose email error.

---

## [3.0.10]

- **[UPDATE]** Update deps.
- **[CHANGE]** Tests `afterAll` not using timeout anymore (conflict with jest 28-alpha).
- **[NEW]** Config for mail now supports "EMAIL_TRANSPORT" env variable. SMTP by default (as was).

---

## [3.0.9]

- **[UPDATE]** Update deps.

---

## [3.0.8]

- **[UPDATE]** Update deps.

---

## [3.0.7]

- **[UPDATE]** Update deps.
- **[CHANGE]** Change default `getConfig` method.

---

## [3.0.6]

- **[UPDATE]** Update deps.

---

## [3.0.5]

- **[UPDATE]** Update deps.

---

## [3.0.4]

- **[UPDATE]** Fix bug with app shutdown.

---

## [3.0.3]

- **[UPDATE]** Update deps.

---

## [3.0.2]

- **[UPDATE]** Update deps.

---

## [3.0.1]

- **[UPDATE]** Update deps.
- **[UPDATE]** `getUserByTokens` more logs.

---

## [3.0.0]

- **[BREAKING]** Mongoose v6. Than a lot of changes:[mongoDB drive changes](https://github.com/mongodb/node-mongodb-native/blob/4.0/docs/CHANGES_4.0.0.md), [Mongoose changes](https://mongoosejs.com/docs/migrating_to_6.html).
  Notable changes from migration
  Removed `execPopulate()`[link](https://mongoosejs.com/docs/migrating_to_6.html#removed-execpopulate)
  ```js
  // Document#populate() now returns a promise and is now no longer chainable.
  //Replace
  await doc.populate('path1').populate('path2').execPopulate();
  // with
  await doc.populate(['path1', 'path2']);
  //Replace
  await doc
    .populate('path1', 'select1')
    .populate('path2', 'select2')
    .execPopulate();
  // with
  await doc.populate([
    { path: 'path1', select: 'select1' },
    { path: 'path2', select: 'select2' },
  ]);
  ```
- **[REMOVED]** Removed deprecated router handler string not allowed anymore. Use functions by itself.
- **[REMOVED]** Removed deprecated `someSecretSalt()` on user model (use `this.saltSecret` instead).
- **[REMOVED]** Removed deprecated `validate()` on abstract controller and as result validator dependency. Use request validators instead.
- **[REMOVED]** Removed deprecated `isUseControllerNameForRouting()` on abstract controller. Use `getExpressPath()` instead.
- **[REMOVED]** Removed deprecated `Base.loadFilesWithInheritance` please use `getFilesPathWithInheritance` that produce almost the same output.
- **[BREAKING]** Removed "success" field on Auth contreoller. Please use http status instead.
- **[BREAKING]** Auth controller - "error" error responce renamed to "message".
  ```js
  // Before
  {
    error: 'Some error';
  }
  // After
  {
    message: 'Some error';
  }
  ```
- **[UPDATE]** Update deps.
- **[UPDATE]** Winston console transport now using timestapms.
- **[UPDATE]** `PrepareAppInfo` middleware now a global one. Do not need to include it on every controller.
- **[NEW]** Request also works with `req.query`, but `req.body` have bigger priority.

---

## [2.18.0]

- **[UPDATE]** Update deps.
- **[UPDATE]** Replace `body-parser` with `express.json`.
- **[NEW]** Role middleware.

---

## [2.17.0]

- **[UPDATE]** Update deps.
- **[NEW]** New env variable `LOGGER_SENTRY_LEVEL` (default=`info`).
- **[NEW]** New env variable `LOGGER_CONSOLE_ENABLE` (default=`true`).
- **[BREAKING]** On translation we changed `i18next`. Please convert files if you have plurals inside it <https://i18next.github.io/i18next-v4-format-converter-web/>.

---

## [2.16.0]

- **[UPDATE]** Update deps.
- **[NEW]** Begin adding type script definitions.

---

## [2.15.4]

- **[UPDATE]** Update deps.
- **[UPDATE]** Update tests timeout.

---

## [2.15.0]

- **[UPDATE]** Update deps.
- **[NEW]** Ability to configure Auth flow with `isAuthWithVefificationFlow` option.
- **[BREAKING]** Register not return status 201 instead of 200.

---

## [2.14.0]

- **[NEW]** Add `Sequence`. It provide ability to easily generate sequences for given types. It save to use on distributed environments.
  ```javascript
  const SequenceModel = this.app.getModel('Sequence');
  // will be 1
  const someTypeSequence = await SequenceModel.getSequence('someType');
  // will be 2
  const someTypeSequence2 = await SequenceModel.getSequence('someType');
  // will be 1 as type is another
  const someAnotherTypeSequence =
    await SequenceModel.getSequence('someAnotherType');
  ```

---

## [2.13.1]

- **[FIX]** Fix documentation about not using `req.appInfo.request`, but using `req.body` for `RateLimiter`.

---

## [2.13.0]

- **[NEW]** Rate limited middleware - ability to include request components (`req.body`) for key generation. Please not that you have no access to `req.appInfo.request` on this stage.
  ```javascript
  static get middleware() {
    return new Map([
      ['POST/login', [
        PrepareAppInfo,
        GetUserByToken,
        [RateLimiter,{consumeKeyComponents: { ip: false, request:['email','phone'] }}]
      ]]
    ]);
  }
  ```

---

## [2.12.0]

- **[UPDATE]** Update deps.
- **[NEW]** Rate limited middleware.
  As rate limited we using <https://github.com/animir/node-rate-limiter-flexible>
  ```javascript
  static get middleware() {
    return new Map([
      ['POST/login', [
        PrepareAppInfo,
        GetUserByToken,
        RateLimiter
      ]]
    ]);
  }
  ```
  Be default rate key generated based on Route, IP and userID. But you can adjust it vie config (global) or via middleware parameters (see v 2.10.0)
  Rate limiter have multiple backends (memory, redis and mongo). Buy default 'memory' backend activated
  ```javascript
  static get middleware() {
    return new Map([
      [
        'POST/login',
        [
          PrepareAppInfo,
          GetUserByToken,
          [
            RateLimiter,
            {
              consumeKeyComponents: { ip: false },
              limiterOptions: { points: 5 },
            },
          ],
        ],
      ],
    ]);
  }
  ```

---

## [2.11.0]

- **[NEW]** Added env variable `HTTP_HOST` for configure host to listen.

---

## [2.10.0]

- **[UPDATE]** Update deps.
- **[NEW]** Ability to pass parameters to middleware.
  ```javascript
  static get middleware() {
    return new Map([
      ['POST/someUrl', [
        PrepareAppInfo,
        GetUserByToken,
        [RoleMiddleware, { roles: ['admin'] ]}]
      ]]
    ]);
  }
  ```
  All this params goes to constructor as a second paramater.

---

## [2.9.2]

- **[UPDATE]** Update deps.
- **[FIX]** Fix auth nick.

---

## [2.9.1]

- **[UPDATE]** Update deps.

---

## [2.9.0]

- **[BREAKING]** Auth controller update.

---

## [2.8.3]

- **[FIX]** Update recovery email template.

---

## [2.8.2]

- **[FIX]** Update AUTH controller.

---

## [2.8.1]

- **[UPDATE]** Update deps.
- **[FIX]** Update AUTH controller.

---

## [2.8.0]

- **[UPDATE]** Change controllers to reflect latest changes.
- **[UPDATE]** Add warning when using `req.body` directly.
- **[BREAKING]** Possible breaking. `AsyncFunction` now required for router handler (it always was but without checking of code).
- **[DEPRECATE]** Usage of `validator` of controllers.
- **[DEPRECATE]** Usage of `isUseControllerNameForRouting` of controllers.

---

## [2.7.4]

- **[UPDATE]** Update deps.

---

## [2.7.3]

- **[UPDATE]** Replace `i18next-node-fs-backend` to `i18next-fs-backend` (drop in replacement).

---

## [2.7.2]

- **[UPDATE]** Update deps.

---

## [2.7.1]

- **[REMOVE]** Remove unused websocket.

---

## [2.7.0]

- **[UPDATE]** Change winston sentry transport.

---

## [2.6.5]

- **[UPDATE]** Update deps.
- **[UPDATE]** Optimize deps.

---

## [2.6.4]

- **[UPDATE]** Update deps.

---

## [2.6.3]

- **[UPDATE]** Update deps.
- **[UPDATE]** Update handling exceptions loging.

---

## [2.6.2]

- **[UPDATE]** Normalize auth config.

---

## [2.6.1]

- **[FIX]** Fix error on cache system.
- **[UPDATE]** `stripUnknown=true` by default on casting.

---

## [2.6.0]

- **[UPDATE]** Deps update.
- **[NEW]** New cache system (alpha, subject of change).
  ```javascript
  const cacheTime = 60 * 5;
  this.app.cache.getSetValue(
    'someKey',
    async () => {
      // function that will execute in case cache value is missed
    },
    cacheTime,
  );
  ```

---

## [2.5.1]

- **[UPDATE]** Deps update.
- **[FIX]** Fix error logging on unhadled rejection.

---

## [2.5.0]

- **[NEW]** New route handler format with request validations and casting (yup based).
  ```javascript
  get routes() {
    return {
      post: {
        '/': {
          handler: this.postSample,
          request: yup.object().shape({
            count: yup.number().max(100)required(),
          })
        }
      }
    }
  }
  // send request with data  {count: "5000"}
  // will produce error with status 400 and {errors: {count:['Text error']}}
  postSample(req,res) =>{
    // on success validate we pass here.
    // {count: "5000"}
    console.log(req.appInfo.request)
    // {count: 5000} -> casted to number
  }
  ```

---

## [2.4.4]

- **[UPDATE]** Deps update.
- **[NEW]** Controller unhandled rejection now handled with default error.
- **[NEW]** Handle error with wrong model name.

---

## [2.4.3]

- **[UPDATE]** Deps update.

---

## [2.4.2]

- **[FIX]** Abstract controlled middleware.
- **[UPDATE]** Deps update.

---

## [2.4.1]

- **[FIX]** Updated test because of previous breaking changes.

---

## [2.4.0]

- **[BREAKING]** Possible that bug fix of middleware can affect your code. Previous route middleware was GLOBAL (`router.use`) now in router level only (`route.any`). Previous Home controller (`/` route be default) middleware affect ANY routes on app. Right now that fixed.
- **[NEW]** Controller middleware now support methods. Previous only `ALL` was supported. Possible to start router with any method that supported by Express and middleware will be scoped by this method. If middleware route started from "/" then `ALL` method will be used (like previous bahaviour).
  ```javascript
  static get middleware() {
    return new Map([['GET/*', [PrepareAppInfo, GetUserByToken]]]);
  }
  ```

---

## [2.3.14]

- **[FIX]** Fix validate controller method for non strings.

---

## [2.3.13]

- **[UPDATE]** Testing now with mongoDB Replica.
- **[UPDATE]** Refactor CLI.

---

## [2.3.12]

- **[UPDATE]** Testing update.

---

## [2.3.11]

- **[UPDATE]** Refactor CLI for testing.

---

## [2.3.10]

- **[UPDATE]** Update user model indexes to allow null email and nick.
- **[UPDATE]** Deps update.

---

## [2.3.9]

- **[FIX]** Test fix.

---

## [2.3.8]

- **[NEW]** Add `global.testSetup.beforeAll` `global.testSetup.afterAll` functions and `global.testSetup.disableUserCreate` flag for testing testing.

---

## [2.3.7]

- **[UPDATE]** Deps update.
- **[NEW]** Add `global.testSetup.userCreate` function for testing.

---

## [2.3.6]

- **[UPDATE]** Deps update.
- **[FIX]** Test fix.

---

## [2.3.5]

- **[NEW]** Add command `DropIndex`.
- **[UPDATE]** Deps update.

---

## [2.3.4]

- **[NEW]** Add `webResources` option to email service.
- **[UPDATE]** Deps update.

---

## [2.3.3]

- **[UPDATE]** Deps update.

---

## [2.3.2]

- **[FIX]** Fix controllers order to load.

---

## [2.3.1]

- **[FIX]** Fix parsing token.

---

## [2.3.0]

- **[NEW]** `Migration/create` `migration/migrate` commands.

---

## [2.2.6]

- **[NEW]** CLI command receiving parsed arguments.

---

## [2.2.5]

- **[FIX]** Fix disconnecting problems with replica set.

---

## [2.2.4]

- **[UPDATE]** Internal update for speed up cli init.

---

## [2.2.3]

- **[FIX]** Fix language detection.

---

## [2.2.2]

- **[FIX]** Fix test as part of docker image update. This just a `mongo-memory-server` problems.
- **[NEW]** Add config to configure language detecting order and types.

---

## [2.2.1]

- **[UPDATE]** Deps update.

---

## [2.2.0]

- **[DEPRECATED]** `Base.loadFilesWithInheritance` please use `getFilesPathWithInheritance` that produce almost the same output.
- **[UPDATE]** Deps update.
- **[UPDATE]** Https logs now contains request time.
- **[NEW]** Ability to put controllers into folders with path inheritance.
- **[NEW]** Ability to replace `expressPath` on controller - `getExpressPath()` methos.
- **[NEW]** Ability to put commands into folders with path inheritance.

---

## [2.1.2]

- **[UPDATE]** Disconnect of mongoose when command was finished.

---

## [2.1.1]

- **[UPDATE]** Deps update.

---

## [2.1.0]

- **[DEV]** Added codestyle checker.
- **[NEW]** Initial CLI module.

---

## [2.0.2]

- **[UPDATE]** Socket.io v3.
- **[UPDATE]** Deps update.

---

## [2.0.1]

- **[NEW]** Added config to websocket.

---

## [2.0.0]

- **[BREAKING]** Change config format of log config. Now configs can be only objects.

---

## [1.5.0]

- **[NEW]** Support for environment configs (`config.js` and `config.{NODE_ENV}.js`) with overwrite.
- **[UPDATE]** Deps update.

---

## [1.4.0]

- **[NEW]** Ability to pass additional parameter to server that will be executed before adding page 404.

---

## [1.3.0]

- **[NEW]** Models now support optional callback that will executed on connection ready. If mongo already connected then callback will be executed immediately.

---

## [1.2.9]

- **[UPDATE]** Update deps.

---

## [1.2.8]

- **[UPDATE]** Update deps.

---

## [1.2.7]

- **[NEW]** Add abilty to return error from custom validation functions.

---

## [1.2.6]

- **[UPDATE]** Validator documentation (jsdoc) update.
- **[UPDATE]** Validator support pass parameters to validator.

---

## [1.2.5]

- **[FIX]** Fix problem with test (user should be global on tests).

---

## [1.2.4]

- **[NEW]** Add eslint.
- **[UPDATE]** Code refactor.

---

## [1.2.3]

- **[NEW]** Add prettier.
- **[UPDATE]** Code reformat.

---

## [1.2.2]

- **[UPDATE]** Update deps.
