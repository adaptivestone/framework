# Changelog — v2.x

Archived release notes for the **2.x** major series.
For current releases see [CHANGELOG.md](./CHANGELOG.md).

## [2.18.0] - 2021-11-02

- **[UPDATE]** Update deps.
- **[UPDATE]** Replace `body-parser` with `express.json`.
- **[NEW]** Role middleware.

---

## [2.17.0] - 2021-10-08

- **[UPDATE]** Update deps.
- **[NEW]** New env variable `LOGGER_SENTRY_LEVEL` (default=`info`).
- **[NEW]** New env variable `LOGGER_CONSOLE_ENABLE` (default=`true`).
- **[BREAKING]** On translation we changed `i18next`. Please convert files if you have plurals inside it <https://i18next.github.io/i18next-v4-format-converter-web/>.

---

## [2.16.0] - 2021-09-22

- **[UPDATE]** Update deps.
- **[NEW]** Begin adding type script definitions.

---

## [2.15.4] - 2021-09-16

- **[UPDATE]** Update deps.
- **[UPDATE]** Update tests timeout.

---

## [2.15.0] - 2021-08-12

- **[UPDATE]** Update deps.
- **[NEW]** Ability to configure Auth flow with `isAuthWithVefificationFlow` option.
- **[BREAKING]** Register not return status 201 instead of 200.

---

## [2.14.0] - 2021-08-10

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

## [2.13.1] - 2021-08-10

- **[FIX]** Fix documentation about not using `req.appInfo.request`, but using `req.body` for `RateLimiter`.

---

## [2.13.0] - 2021-08-10

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

## [2.12.0] - 2021-08-09

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

## [2.11.0] - 2021-08-06

- **[NEW]** Added env variable `HTTP_HOST` for configure host to listen.

---

## [2.10.0] - 2021-08-05

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

## [2.9.2] - 2021-07-28

- **[UPDATE]** Update deps.
- **[FIX]** Fix auth nick.

---

## [2.9.1] - 2021-07-07

- **[UPDATE]** Update deps.

---

## [2.9.0] - 2021-06-30

- **[BREAKING]** Auth controller update.

---

## [2.8.3] - 2021-06-30

- **[FIX]** Update recovery email template.

---

## [2.8.2] - 2021-06-30

- **[FIX]** Update AUTH controller.

---

## [2.8.1] - 2021-06-30

- **[UPDATE]** Update deps.
- **[FIX]** Update AUTH controller.

---

## [2.8.0] - 2021-06-24

- **[UPDATE]** Change controllers to reflect latest changes.
- **[UPDATE]** Add warning when using `req.body` directly.
- **[BREAKING]** Possible breaking. `AsyncFunction` now required for router handler (it always was but without checking of code).
- **[DEPRECATE]** Usage of `validator` of controllers.
- **[DEPRECATE]** Usage of `isUseControllerNameForRouting` of controllers.

---

## [2.7.4] - 2021-06-23

- **[UPDATE]** Update deps.

---

## [2.7.3] - 2021-05-27

- **[UPDATE]** Replace `i18next-node-fs-backend` to `i18next-fs-backend` (drop in replacement).

---

## [2.7.2] - 2021-05-27

- **[UPDATE]** Update deps.

---

## [2.7.1] - 2021-05-21

- **[REMOVE]** Remove unused websocket.

---

## [2.7.0] - 2021-05-21

- **[UPDATE]** Change winston sentry transport.

---

## [2.6.5] - 2021-05-20

- **[UPDATE]** Update deps.
- **[UPDATE]** Optimize deps.

---

## [2.6.4] - 2021-05-16

- **[UPDATE]** Update deps.

---

## [2.6.3] - 2021-04-20

- **[UPDATE]** Update deps.
- **[UPDATE]** Update handling exceptions loging.

---

## [2.6.2] - 2021-04-19

- **[UPDATE]** Normalize auth config.

---

## [2.6.1] - 2021-04-13

- **[FIX]** Fix error on cache system.
- **[UPDATE]** `stripUnknown=true` by default on casting.

---

## [2.6.0] - 2021-04-13

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

## [2.5.1] - 2021-04-04

- **[UPDATE]** Deps update.
- **[FIX]** Fix error logging on unhadled rejection.

---

## [2.5.0] - 2021-03-31

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

## [2.4.4] - 2021-03-31

- **[UPDATE]** Deps update.
- **[NEW]** Controller unhandled rejection now handled with default error.
- **[NEW]** Handle error with wrong model name.

---

## [2.4.3] - 2021-03-17

- **[UPDATE]** Deps update.

---

## [2.4.2] - 2021-03-03

- **[FIX]** Abstract controlled middleware.
- **[UPDATE]** Deps update.

---

## [2.4.1] - 2021-02-24

- **[FIX]** Updated test because of previous breaking changes.

---

## [2.4.0] - 2021-02-24

- **[BREAKING]** Possible that bug fix of middleware can affect your code. Previous route middleware was GLOBAL (`router.use`) now in router level only (`route.any`). Previous Home controller (`/` route be default) middleware affect ANY routes on app. Right now that fixed.
- **[NEW]** Controller middleware now support methods. Previous only `ALL` was supported. Possible to start router with any method that supported by Express and middleware will be scoped by this method. If middleware route started from "/" then `ALL` method will be used (like previous bahaviour).
  ```javascript
  static get middleware() {
    return new Map([['GET/*', [PrepareAppInfo, GetUserByToken]]]);
  }
  ```

---

## [2.3.14] - 2021-02-23

- **[FIX]** Fix validate controller method for non strings.

---

## [2.3.13] - 2021-02-22

- **[UPDATE]** Testing now with mongoDB Replica.
- **[UPDATE]** Refactor CLI.

---

## [2.3.12] - 2021-02-22

- **[UPDATE]** Testing update.

---

## [2.3.11] - 2021-02-22

- **[UPDATE]** Refactor CLI for testing.

---

## [2.3.10] - 2021-02-22

- **[UPDATE]** Update user model indexes to allow null email and nick.
- **[UPDATE]** Deps update.

---

## [2.3.9] - 2021-02-18

- **[FIX]** Test fix.

---

## [2.3.8] - 2021-02-18

- **[NEW]** Add `global.testSetup.beforeAll` `global.testSetup.afterAll` functions and `global.testSetup.disableUserCreate` flag for testing testing.

---

## [2.3.7] - 2021-02-18

- **[UPDATE]** Deps update.
- **[NEW]** Add `global.testSetup.userCreate` function for testing.

---

## [2.3.6] - 2021-02-10

- **[UPDATE]** Deps update.
- **[FIX]** Test fix.

---

## [2.3.5] - 2021-02-03

- **[NEW]** Add command `DropIndex`.
- **[UPDATE]** Deps update.

---

## [2.3.4] - 2021-01-31

- **[NEW]** Add `webResources` option to email service.
- **[UPDATE]** Deps update.

---

## [2.3.3] - 2021-01-29

- **[UPDATE]** Deps update.

---

## [2.3.2] - 2021-01-29

- **[FIX]** Fix controllers order to load.

---

## [2.3.1] - 2021-01-15

- **[FIX]** Fix parsing token.

---

## [2.3.0] - 2021-01-05

- **[NEW]** `Migration/create` `migration/migrate` commands.

---

## [2.2.6] - 2021-01-04

- **[NEW]** CLI command receiving parsed arguments.

---

## [2.2.5] - 2021-01-04

- **[FIX]** Fix disconnecting problems with replica set.

---

## [2.2.4] - 2021-01-04

- **[UPDATE]** Internal update for speed up cli init.

---

## [2.2.3] - 2020-12-22

- **[FIX]** Fix language detection.

---

## [2.2.2] - 2020-12-22

- **[FIX]** Fix test as part of docker image update. This just a `mongo-memory-server` problems.
- **[NEW]** Add config to configure language detecting order and types.

---

## [2.2.1] - 2020-12-05

- **[UPDATE]** Deps update.

---

## [2.2.0] - 2020-12-05

- **[DEPRECATED]** `Base.loadFilesWithInheritance` please use `getFilesPathWithInheritance` that produce almost the same output.
- **[UPDATE]** Deps update.
- **[UPDATE]** Https logs now contains request time.
- **[NEW]** Ability to put controllers into folders with path inheritance.
- **[NEW]** Ability to replace `expressPath` on controller - `getExpressPath()` methos.
- **[NEW]** Ability to put commands into folders with path inheritance.

---

## [2.1.2] - 2020-12-01

- **[UPDATE]** Disconnect of mongoose when command was finished.

---

## [2.1.1] - 2020-12-01

- **[UPDATE]** Deps update.

---

## [2.1.0] - 2020-12-01

- **[DEV]** Added codestyle checker.
- **[NEW]** Initial CLI module.

---

## [2.0.2] - 2020-11-26

- **[UPDATE]** Socket.io v3.
- **[UPDATE]** Deps update.

---

## [2.0.1] - 2020-10-28

- **[NEW]** Added config to websocket.

---

## [2.0.0] - 2020-10-04

- **[BREAKING]** Change config format of log config. Now configs can be only objects.

---

