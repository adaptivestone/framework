import fs from 'node:fs';
import type { Request, Response } from 'express';
import { HttpResponse } from '../../services/http/responses.ts';
import { startTestServer, stopTestServer } from '../setupFramework.ts';
import { configureTestServer, getTestServerURL } from '../testHelpers.ts';

// Consumer-side test bootstrap, spawned in a child so it boots its own test
// server (the framework suite already owns one per test file). Mirrors what a
// project preload does: declare Server options BEFORE the lifecycle boots, then
// let the shipped setup start the server. Reads `TEST_MONGO_URI` from the env
// (inherited from the parent test run's global setup).
// Markers on stdout: `HOOK_RAN`, `ROUTE_STATUS:<n>`, `ROUTE_BODY:<json>`,
// `RETURNED_BODY:<json>`, `NOT_FOUND_STATUS:<n>`, `NOT_FOUND_BODY:<json>`.

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
    app.httpServer.routeRegistry.registerRoute('GET', '/adhoc-returned', {
      handler: () => HttpResponse.json(200, { returned: true }),
    });
  },
  // Wraps every framework-rendered JSON body; `res.json` above bypasses it.
  transformResponse: (response) =>
    response.kind === 'json'
      ? HttpResponse.json(
          response.status,
          { data: response.body },
          { headers: response.headers, contentType: response.contentType },
        )
      : response,
});

await startTestServer();

const response = await fetch(getTestServerURL('/adhoc-from-boot-hook'));
fs.writeSync(1, `ROUTE_STATUS:${response.status}\n`);
fs.writeSync(1, `ROUTE_BODY:${JSON.stringify(await response.json())}\n`);

const returned = await fetch(getTestServerURL('/adhoc-returned'));
fs.writeSync(1, `RETURNED_BODY:${JSON.stringify(await returned.json())}\n`);

const notFound = await fetch(getTestServerURL('/no-such-route'));
fs.writeSync(1, `NOT_FOUND_STATUS:${notFound.status}\n`);
fs.writeSync(1, `NOT_FOUND_BODY:${JSON.stringify(await notFound.json())}\n`);

await stopTestServer();
process.exit(0);
