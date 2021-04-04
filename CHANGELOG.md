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
