### 3.0.5

[UPDATE] update deps

### 3.0.4

[UPDATE] fix bug with app shutdown

### 3.0.3

[UPDATE] update deps

### 3.0.2

[UPDATE] update deps

### 3.0.1

[UPDATE] update deps
[UPDATE] getUserByTokens more logs

### 3.0.0

[BREAKING] Mongoose v6. Than a lot of changes:[mongoDB drive changes](https://github.com/mongodb/node-mongodb-native/blob/4.0/docs/CHANGES_4.0.0.md), [Mongoose changes](https://mongoosejs.com/docs/migrating_to_6.html).
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

[REMOVED] removed deprecated router handler string not allowed anymore. Use functions by itself
[REMOVED] removed deprecated someSecretSalt() on user model (use this.saltSecret instead)
[REMOVED] removed deprecated validate() on abstract controller and as result validator dependency. Use request validators instead
[REMOVED] removed deprecated isUseControllerNameForRouting() on abstract controller. Use getExpressPath() instead
[REMOVED] removed deprecated Base.loadFilesWithInheritance please use getFilesPathWithInheritance that produce almost the same output
[BREAKING] Removed "success" field on Auth contreoller. Please use http status instead
[BREAKING] Auth controller - "error" error responce renamed to "message"

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

[UPDATE] update deps
[UPDATE] winston console transport now using timestapms
[UPDATE] PrepareAppInfo middleware now a global one. Do not need to include it on every controller
[NEW] Request anso works with req.query, but req.body have bigger priority

### 2.18.0

[UPDATE] update deps
[UPDATE] replace body-parser with express.json
[NEW] role middleware

### 2.17.0

[UPDATE] update deps
[NEW] new env variable LOGGER_SENTRY_LEVEL (default=info)
[NEW] new env variable LOGGER_CONSOLE_ENABLE (default=true)
[BREAKING] on translation we changed i18next. Please convert files if you have plurals inside it https://i18next.github.io/i18next-v4-format-converter-web/

#### 2.16.0

[UPDATE] update deps
[NEW] begin adding type script definitions

#### 2.15.4

[UPDATE] update deps
[UPDATE] update tests timeout

#### 2.15.0

[UPDATE] update deps
[NEW] Ability to configure Auth flow with 'isAuthWithVefificationFlow' option.
[BREAKING] Register not return status 201 instead of 200

#### 2.14.0

[NEW] Add Sequence. It provide ability to easily generate sequences for given types. It save to use on distributed environments

```javascript
const SequenceModel = this.app.getModel('Sequence');
// will be 1
const someTypeSequence = await SequenceModel.getSequence('someType');
// will be 2
const someTypeSequence2 = await SequenceModel.getSequence('someType');
// will be 1 as type is another
const someAnotherTypeSequence = await SequenceModel.getSequence(
  'someAnotherType',
);
```

#### 2.13.1

[FIX] fix documentation about not using req.appInfo.request, but using req.body for RateLimiter

#### 2.13.0

[NEW] Rate limited middleware - ability to include request components (req.body) for key generation. Please not that you have no access to req.appInfo.request on this stage

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

#### 2.12.0

[UPDATE] update deps
[NEW] Rate limited middleware

As rate limited we using https://github.com/animir/node-rate-limiter-flexible

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

#### 2.11.0

[NEW] Added env variable HTTP_HOST for configure host to listen

#### 2.10.0

[UPDATE] update deps
[NEW] ability to pass parameters to middleware

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

All this params goes to constructor as a second paramater

#### 2.9.2

[UPDATE] update deps
[FIX] fix auth nick

#### 2.9.1

[UPDATE] update deps

#### 2.9.0

[BREAKING] Auth controller update

#### 2.8.3

[FIX] update recovery email template

#### 2.8.2

[FIX] update AUTH controller

#### 2.8.1

[UPDATE] update deps
[FIX] update AUTH controller

#### 2.8.0

[UPDATE] change controllers to reflect latest changes
[UPDATE] add warning when using 'req.body' directly
[BREAKING] Possible breaking. AsyncFunction now required for router handler (it always was but without checking of code)
[DEPRECATE] usage of 'validator' of controllers
[DEPRECATE] usage of 'isUseControllerNameForRouting' of controllers.

#### 2.7.4

[UPDATE] update deps

#### 2.7.3

[UPDATE] replace i18next-node-fs-backend to i18next-fs-backend (drop in replacement)

#### 2.7.2

[UPDATE] update deps

#### 2.7.1

[REMOVE] remove unused websocket

#### 2.7.0

[UPDATE] change winston sentry transport

#### 2.6.5

[UPDATE] update deps
[UPDATE] optimize deps

#### 2.6.4

[UPDATE] update deps

#### 2.6.3

[UPDATE] update deps
[UPDATE] update handling exceptions loging

#### 2.6.2

[UPDATE] normalize auth config

#### 2.6.1

[FIX] fix error on cache system
[UPDATE] stripUnknown=true by default on casting

#### 2.6.0

[UPDATE] deps update
[NEW]new cache system (alpha, subject of change)

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

#### 2.5.1

[UPDATE] deps update
[FIX] fix error logging on unhadled rejection

#### 2.5.0

[NEW] new route handler format with request validations and casting (yup based)

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

#### 2.4.4

[UPDATE] deps update
[NEW] controller unhandled rejection now handled with default error
[NEW] handle error with wrong model name

#### 2.4.3

[UPDATE] deps update

#### 2.4.2

[FIX] abstract controlled middleware
[UPDATE] deps update

#### 2.4.1

[FIX] updated test because of previous breaking changes

#### 2.4.0

[BREAKING] possible that bug fix of middleware can affect your code. Previous route middleware was GLOBAL (router.use) now in router level only (route.any). Previous Home controller (/ route be default) middleware affect ANY routes on app. Right now that fixed.

[NEW] Controller middleware now support methods. Previous only ALL was supported. Possible to start router with any method that supported by Express and middleware will be scoped by this method. If middleware route started from "/" then ALL method will be used (like previous bahaviour)

```javascript
  static get middleware() {
    return new Map([['GET/*', [PrepareAppInfo, GetUserByToken]]]);
  }
```

#### 2.3.14

[FIX] fix validate controller method for non strings

#### 2.3.13

[UPDATE] testing now with mongoDB Replica
[UPDATE] refactor CLI

#### 2.3.12

[UPDATE] testing update

#### 2.3.11

[UPDATE] refactor CLI for testing

#### 2.3.10

[UPDATE] update user model indexes to allow null email and nick
[UPDATE] deps update

#### 2.3.9

[FIX] test fix

#### 2.3.8

[NEW] add 'global.testSetup.beforeAll' 'global.testSetup.afterAll' functions and 'global.testSetup.disableUserCreate' flag for testing testing

#### 2.3.7

[UPDATE] deps update
[NEW] add 'global.testSetup.userCreate' function for testing

#### 2.3.6

[UPDATE] deps update
[FIX] test fix

#### 2.3.5

[NEW] Add command DropIndex
[UPDATE] deps update

#### 2.3.4

[NEW] Add webResources option to email service
[UPDATE] deps update

#### 2.3.3

[UPDATE] deps update

#### 2.3.2

[FIX] Fix controllers order to load

#### 2.3.1

[FIX] Fix parsing token

#### 2.3.0

[NEW] Migration/create migration/migrate commands

#### 2.2.6

[NEW] CLI command receiving parsed arguments

#### 2.2.5

[FIX] Fix disconnecting problems with replica set

#### 2.2.4

[UPDATE] Internal update for speed up cli init

#### 2.2.3

[FIX] fix language detection

#### 2.2.2

[FIX] fix test as part of docker image update. This just a mongo-memory-server problems
[NEW] add config to configure language detecting order and types

#### 2.2.1

[UPDATE] deps update

#### 2.2.0

[DEPRECATED] Base.loadFilesWithInheritance please use getFilesPathWithInheritance that produce almost the same output
[UPDATE] deps update
[UPDATE] https logs now contains request time
[NEW] Ability to put controllers into folders with path inheritance
[NEW] Ability to replace expressPath on controller - getExpressPath() methos
[NEW] Ability to put commands into folders with path inheritance

#### 2.1.2

[UPDATE] disconnect of mongoose when command was finished

#### 2.1.1

[UPDATE] deps update

#### 2.1.0

[DEV] added codestyle checker
[NEW] Initial CLI module

#### 2.0.2 released

[UPDATE] socket.io v3
[UPDATE] deps update

#### 2.0.1

[NEW] Added config to websocket

#### 2.0.0

[BREAKING] Change config format of log config. Now configs can be only objects

#### 1.5.0

[NEW] Support for environment configs (config.js and config.{NODE_ENV}.js) with overwrite
[UPDATE] deps update

#### 1.4.0

Ability to pass additional parameter to server that will be executed before adding page 404

#### 1.3.0

Models now support optional callback that will executed on connection ready. If mongo already connected then callback will be executed immediately

#### 1.2.9

Update deps

#### 1.2.8

Update deps

#### 1.2.7

Add abilty to return error from custom validation functions

#### 1.2.6

Validator documentation (jsdoc) update
Validator support pass parameters to validator

#### 1.2.5

Fix problem with test (user should be global on tests)

#### 1.2.4

Add eslint
Code refactor

#### 1.2.3

Add prettier
Code reformat

#### 1.2.2

Update deps
