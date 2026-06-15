# Changelog — v3.x

Archived release notes for the **3.x** major series.
For current releases see [CHANGELOG.md](./CHANGELOG.md).

## [3.4.3] - 2023-02-03

- **[UPDATE]** Updated deps.
- **[FIX]** Fix tests for redis.
- **[FIX]** Support in tests `TEST_FOLDER_EMAILS`.

---

## [3.4.2] - 2022-12-29

- **[UPDATE]** Updated deps.
- **[FIX]** Fix documentation generation.

---

## [3.4.1] - 2022-12-23

- **[FIX]** Fix documentation generation.

---

## [3.4.0] - 2022-12-21

- **[NEW]** Now we pass `req` to validation and casting as a second parameter. This done mostly for custom validators.

---

## [3.3.0] - 2022-12-20

- **[NEW]** New command `SyncIndexes` to sync indexes for mongodb <https://framework.adaptivestone.com/docs/cli#syncindexes>.
- **[UPDATE]** Updated deps.
- **[FIX]** Fix documentation generation.

---

## [3.2.2] - 2022-12-14

- **[UPDATE]** Add options for `i18n` to config.
- **[CHANGE]** By default `i18n` not writing missed keys. Can be enabled via config.

---

## [3.2.1] - 2022-12-14

- **[UPDATE]** Updated deps.
- **[FIX]** Fix documentation generation.

---

## [3.2.0] - 2022-11-30

- **[UPDATE]** Updated deps.
- **[NEW]** `cache.removeKey(key)` - function to remove key from cache.

---

## [3.1.1] - 2022-11-25

- **[UPDATE]** Updated deps.
- **[FIX]** Fix cache error handling.

---

## [3.1.0] - 2022-11-24

- **[NEW]** New comand to generate open API documentation (wip).
- **[NEW]** Coverage report.
- **[UPDATE]** Updated deps.

---

## [3.0.23] - 2022-11-10

- **[UPDATE]** Updated deps.
- **[FIX]** Fix custom errors.

---

## [3.0.22] - 2022-10-24

- **[UPDATE]** Updated deps.
- **[UPDATE]** Cast function now can be ASYNC too.

---

## [3.0.21] - 2022-10-18

- **[UPDATE]** Updated redis to v4.
- **[NEW]** Updates tests to have own namespace on redis.

---

## [3.0.20] - 2022-10-12

- **[UPDATE]** Update deps.

---

## [3.0.19] - 2022-09-18

- **[UPDATE]** Update deps.

---

## [3.0.18] - 2022-08-17

- **[UPDATE]** Update deps.
- **[UPDATE]** Change default branch to `main`.

---

## [3.0.17] - 2022-05-12

- **[UPDATE]** Update deps.

---

## [3.0.16] - 2022-04-28

- **[UPDATE]** Update deps.
- **[FIX]** Fix bug with route level middleware.

---

## [3.0.15] - 2022-04-26

- **[UPDATE]** Update deps.
- **[UPDATE]** Minimum node version 16.

---

## [3.0.14] - 2022-04-09

- **[NEW]** Now possible to show all errors during validation (default one) by parameter `controllerValidationAbortEarly`.
- **[UPDATE]** Update deps.

---

## [3.0.13] - 2022-03-30

- **[UPDATE]** Bug fix with "mergeParams".

---

## [3.0.12] - 2022-03-30

- **[NEW]** Ability to pass "mergeParams" options to express router.
- **[UPDATE]** Update deps.

---

## [3.0.11] - 2022-03-29

- **[UPDATE]** More verbose email error.

---

## [3.0.10] - 2022-03-29

- **[UPDATE]** Update deps.
- **[CHANGE]** Tests `afterAll` not using timeout anymore (conflict with jest 28-alpha).
- **[NEW]** Config for mail now supports "EMAIL_TRANSPORT" env variable. SMTP by default (as was).

---

## [3.0.9] - 2022-03-22

- **[UPDATE]** Update deps.

---

## [3.0.8] - 2022-03-22

- **[UPDATE]** Update deps.

---

## [3.0.7] - 2022-03-01

- **[UPDATE]** Update deps.
- **[CHANGE]** Change default `getConfig` method.

---

## [3.0.6] - 2022-02-19

- **[UPDATE]** Update deps.

---

## [3.0.5] - 2022-02-14

- **[UPDATE]** Update deps.

---

## [3.0.4] - 2022-01-24

- **[UPDATE]** Fix bug with app shutdown.

---

## [3.0.3] - 2022-01-24

- **[UPDATE]** Update deps.

---

## [3.0.2] - 2022-01-03

- **[UPDATE]** Update deps.

---

## [3.0.1] - 2021-12-27

- **[UPDATE]** Update deps.
- **[UPDATE]** `getUserByTokens` more logs.

---

## [3.0.0] - 2021-12-15

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
- **[BREAKING]** Auth controller - "error" error response renamed to "message".
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

