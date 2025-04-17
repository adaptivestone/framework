import { createServer } from 'node:http';
import { describe, it, expect } from 'vitest';
import { PersistentFile } from 'formidable';

import RequestParser from './RequestParser.ts';

describe('reqest parser limiter methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new RequestParser(global.server.app);

    expect(RequestParser.description).toBeDefined();
  });

  it('middleware that works', async () => {
    expect.assertions(4);

    await new Promise((done) => {
      // from https://github.com/node-formidable/formidable/blob/master/test-node/standalone/promise.test.js

      const server = createServer(async (req, res) => {
        req.appInfo = {};
        const middleware = new RequestParser(global.server.app);
        middleware.middleware(req, {}, (err) => {
          expect(err).toBeUndefined();
          expect(req.body.title).toBeDefined();
          expect(req.body.multipleFiles).toBeDefined();
          expect(
            req.body.multipleFiles[0] instanceof PersistentFile,
          ).toBeTruthy();

          res.writeHead(200);
          res.end('ok');
        });
      });
      server.listen(null, async () => {
        const address = server.address();
        const chosenPort = typeof address === 'string' ? 0 : address.port;
        const body = `----13068458571765726332503797717\r
Content-Disposition: form-data; name="title"\r
\r
a\r
----13068458571765726332503797717\r
Content-Disposition: form-data; name="multipleFiles"; filename="x.txt"\r
Content-Type: application/x-javascript\r
\r
\r
\r
a\r
b\r
c\r
d\r
\r
----13068458571765726332503797717--\r
`;
        await fetch(String(new URL(`http:localhost:${chosenPort}/`)), {
          method: 'POST',
          headers: {
            'Content-Length': body.length.toString(),
            Host: `localhost:${chosenPort}`,
            'Content-Type':
              'multipart/form-data; boundary=--13068458571765726332503797717',
          },
          body,
        }).catch((err) => {
          console.error(err);
          done(err);
        });
        server.close(() => {
          done();
        });
      });
    });
  });

  it('middleware with a problem', async () => {
    expect.assertions(1);

    await new Promise((done) => {
      // from https://github.com/node-formidable/formidable/blob/master/test-node/standalone/promise.test.js

      const server = createServer(async (req, res) => {
        req.appInfo = {};
        const middleware = new RequestParser(global.server.app);
        let status;

        const resp = {
          status: (code) => {
            status = code;
            return resp;
          },
          json: () => resp,
        };
        await middleware.middleware(req, resp, () => {});

        expect(status).toBe(400);
        // expect(err).toBeDefined();

        res.writeHead(200);
        res.end('ok');
      });
      server.listen(null, async () => {
        const address = server.address();
        const chosenPort = typeof address === 'string' ? 0 : address.port;
        const body = 'someBadBody';

        await fetch(String(new URL(`http:localhost:${chosenPort}/`)), {
          method: 'POST',
          headers: {
            'Content-Length': body.length.toString(),
            Host: `localhost:${chosenPort}`,
            'Content-Type': 'badContentType',
          },
          body,
        }).catch((err) => {
          console.error(err);
          done(err);
        });
        server.close(() => {
          done();
        });
      });
    });
  });
});
