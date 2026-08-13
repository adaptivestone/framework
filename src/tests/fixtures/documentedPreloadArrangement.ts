import fs from 'node:fs';
import type { Request, Response } from 'express';
import { configureTestServer } from '../testHelpers.ts';
import '../setupNodeTest.ts';

// Mirrors the 5.3.3 changelog snippet exactly: the setup glue is imported ABOVE
// the `configureTestServer` call (imports hoist, so the call is the last thing
// this module runs). Regression for the boot firing at `before()` registration
// — inside the glue's import — and closing the options window before this body
// ever executed. Markers on stdout: `DOC_PRELOAD_OK`, `DOC_HOOK_RAN`.
configureTestServer({
  bootHttp: (app) => {
    fs.writeSync(1, 'DOC_HOOK_RAN\n');
    app.httpServer?.routeRegistry.registerRoute(
      'GET',
      '/from-documented-preload',
      {
        handler: async (_req: Request, res: Response) => {
          res.json({ documented: 'ok' });
        },
      },
    );
  },
});
fs.writeSync(1, 'DOC_PRELOAD_OK\n');
