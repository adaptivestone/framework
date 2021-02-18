#### 2.3.7

[UPDATE] deps update
[NEW] add 'global.testSetup.userCreate' functuon for testing

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
