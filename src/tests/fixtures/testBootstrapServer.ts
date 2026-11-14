import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { startTestServer, stopTestServer } from '../setupFramework.ts';
import { configureTestServer, getTestServerURL } from '../testHelpers.ts';

// Consumer-side test bootstrap, spawned in a child so it boots its own test
// server (the framework suite already owns one per test file). Mirrors what a
// project preload does: declare Server options BEFORE the lifecycle boots, then
// let the shipped setup start the server. Reads `TEST_MONGO_URI` from the env
// (inherited from the parent test run's global setup).
// Markers on stdout: `HOOK_RAN`, `ROUTE_STATUS:<n>`, `ROUTE_BODY:<json>`.

configureTestServer({
  bootHttp: (app) => {
    if (!app.httpServer) {
      throw new Error('bootHttp ran without a live httpServer');
    }
    fs.writeSync(1, 'HOOK_RAN\n');
    app.httpServer.routeRegistry.registerRoute('GET', '/adhoc-from-boot-hook', {
      handler: async (_req: Request, res: Response) => {
        res.json({ bootHttp: 'ran' });
      },
    });
  },
});

const server = await startTestServer();
const dbName = mongoose.connection.name;
const connectionString = server.getConfig('mongo').connectionString;
assert.ok(typeof connectionString === 'string');
const observer = await new mongoose.mongo.MongoClient(
  connectionString,
).connect();

const response = await fetch(getTestServerURL('/adhoc-from-boot-hook'));
fs.writeSync(1, `ROUTE_STATUS:${response.status}\n`);
fs.writeSync(1, `ROUTE_BODY:${JSON.stringify(await response.json())}\n`);

await stopTestServer();
const databases = await observer.db().admin().listDatabases();
assert.ok(!databases.databases.some((database) => database.name === dbName));
fs.writeSync(1, 'TEST_DATABASE_DROPPED\n');
await observer.close();
process.exit(0);
