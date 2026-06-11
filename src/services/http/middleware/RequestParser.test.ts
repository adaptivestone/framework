import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Response } from 'express';
import { PersistentFile } from 'formidable';
import { describe, expect, it } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';

import RequestParser from './RequestParser.ts';

const boundary = 'testboundary18';
const multipartBody =
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="title"\r\n\r\n` +
  `hello\r\n` +
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="upload"; filename="x.txt"\r\n` +
  `Content-Type: text/plain\r\n\r\n` +
  `file-contents-here\r\n` +
  `--${boundary}--\r\n`;
const multipartCT = `multipart/form-data; boundary=${boundary}`;

const waitFor = async (pred: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('condition not met in time');
};

// Drives RequestParser through a real HTTP round-trip and returns the resulting
// status + parsed `req.body`. A shim gives the (Express-shaped) status/json the
// error path needs while delegating `once` to the real response so the
// temp-file cleanup (registered on 'finish'/'close') actually runs.
const postToParser = ({
  body,
  contentType,
  params,
}: {
  body: string;
  contentType: string;
  params?: Record<string, unknown>;
}): Promise<{ status: number; body: Record<string, unknown> }> =>
  new Promise((resolve) => {
    let result = { status: 0, body: {} as Record<string, unknown> };
    const server = createServer(async (req, res) => {
      const frReq = req as unknown as FrameworkRequest;
      frReq.appInfo = { app: appInstance, request: {}, query: {} };
      frReq.body = {};
      let status = 200;
      const resShim = {
        status(code: number) {
          status = code;
          return resShim;
        },
        json() {
          res.writeHead(status);
          res.end('{}');
          return resShim;
        },
        once(event: string, cb: () => void) {
          res.once(event, cb);
          return resShim;
        },
      };
      await new RequestParser(appInstance, params).middleware(
        frReq,
        resShim as unknown as Response,
        (() => {
          result = { status: 200, body: frReq.body };
          res.writeHead(200);
          res.end('ok');
        }) as NextFunction,
      );
      if (status !== 200) {
        result = { status, body: frReq.body };
      }
    });
    server.listen(null, async () => {
      const address = server.address();
      const port = typeof address === 'string' ? 0 : address?.port;
      await fetch(`http://localhost:${port}/`, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        body,
      }).catch(() => {});
      server.close(() => resolve(result));
    });
  });

describe('reqest parser limiter methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new RequestParser(appInstance);

    expect(RequestParser.description).toBeDefined();
  });

  it('middleware that works', async () => {
    expect.assertions(4);

    await new Promise<boolean>((done) => {
      // from https://github.com/node-formidable/formidable/blob/master/test-node/standalone/promise.test.js

      const server = createServer(async (req: IncomingMessage, res) => {
        // Add appInfo property to req
        (req as unknown as FrameworkRequest).appInfo = {
          app: appInstance,
          request: {},
          query: {},
        };

        const middleware = new RequestParser(appInstance);
        middleware.middleware(
          req as FrameworkRequest,
          // pass the real response so the cleanup hooks (res.once) attach
          res as unknown as Response,
          ((err?: Error) => {
            expect(err).toBeUndefined();

            // Get the body once to avoid linting issues
            const reqBody = (req as unknown as FrameworkRequest).body;
            expect(reqBody.title).toBeDefined();
            expect(reqBody.multipleFiles).toBeDefined();
            expect(
              reqBody.multipleFiles[0] instanceof PersistentFile,
            ).toBeTruthy();

            res.writeHead(200);
            res.end('ok');
          }) as NextFunction,
        );
      });
      server.listen(null, async () => {
        const address = server.address();
        const chosenPort = typeof address === 'string' ? 0 : address?.port;
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
          done(true);
        });
      });
    });
  });

  it('middleware with a problem', async () => {
    expect.assertions(1);

    await new Promise<boolean>((done) => {
      // from https://github.com/node-formidable/formidable/blob/master/test-node/standalone/promise.test.js

      const server = createServer(async (req: IncomingMessage, res) => {
        const frReq = {
          ...req,
          appInfo: {
            app: appInstance,
            request: {},
            query: {},
          },
          body: {},
        } as FrameworkRequest;
        const middleware = new RequestParser(appInstance);
        let status = 0;

        const resp = {
          status: (code: number) => {
            status = code;
            return resp;
          },
          json: () => resp,
          once: () => resp,
        };
        await middleware.middleware(
          frReq,
          resp as unknown as Response,
          (() => {}) as NextFunction,
        );

        expect(status).toBe(400);
        // expect(err).toBeDefined();

        res.writeHead(200);
        res.end('ok');
      });
      server.listen(null, async () => {
        const address = server.address();
        const chosenPort = typeof address === 'string' ? 0 : address?.port;
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
          done(true);
        });
      });
    });
  });

  describe('limits + cleanup + field shapes (doc 18)', () => {
    it('removes the spooled temp file after the response finishes', async () => {
      const { body } = await postToParser({
        body: multipartBody,
        contentType: multipartCT,
      });
      const upload = body.upload as { filepath: string }[];
      const filepath = upload[0].filepath;
      expect(filepath).toBeTruthy();
      // cleanup unlinks asynchronously on 'finish'; poll for removal.
      await waitFor(() => !existsSync(filepath));
    });

    it('returns 413 and leaves no temp file when an upload exceeds maxFileSize', async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'rp-413-'));
      try {
        const { status } = await postToParser({
          body: multipartBody,
          contentType: multipartCT,
          params: { maxFileSize: 2, uploadDir: dir },
        });
        expect(status).toBe(413);
        await waitFor(() => readdirSync(dir).length === 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('normalizes a single urlencoded field to a scalar (fixes GetUserByToken)', async () => {
      const { body } = await postToParser({
        body: 'token=abc',
        contentType: 'application/x-www-form-urlencoded',
      });
      expect(body.token).toBe('abc'); // scalar, not ['abc']
    });

    it('keeps repeated urlencoded keys as arrays', async () => {
      const { body } = await postToParser({
        body: 'tags=a&tags=b',
        contentType: 'application/x-www-form-urlencoded',
      });
      expect(body.tags).toEqual(['a', 'b']);
    });

    it('leaves json bodies untouched (single-element arrays not collapsed)', async () => {
      const { body } = await postToParser({
        body: JSON.stringify({ token: 'abc', tags: ['x'] }),
        contentType: 'application/json',
      });
      expect(body.token).toBe('abc');
      expect(body.tags).toEqual(['x']);
    });
  });
});
