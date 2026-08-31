import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import type { NextFunction, Response } from 'express';
import { PersistentFile } from 'formidable';
import { appInstance } from '../../../helpers/appInstance.ts';
import { stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
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
    // const middleware = new RequestParser(appInstance);

    assert.notStrictEqual(RequestParser.description, undefined);
  });

  it('middleware that works', async () => {
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
            assert.strictEqual(err, undefined);

            // Get the body once to avoid linting issues
            const reqBody = (req as unknown as FrameworkRequest).body;
            assert.notStrictEqual(reqBody.title, undefined);
            assert.notStrictEqual(reqBody.multipleFiles, undefined);
            assert.ok(reqBody.multipleFiles[0] instanceof PersistentFile);

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

        assert.strictEqual(status, 400);
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
      assert.ok(filepath);
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
        assert.strictEqual(status, 413);
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
      assert.strictEqual(body.token, 'abc'); // scalar, not ['abc']
    });

    it('keeps repeated urlencoded keys as arrays', async () => {
      const { body } = await postToParser({
        body: 'tags=a&tags=b',
        contentType: 'application/x-www-form-urlencoded',
      });
      assert.deepStrictEqual(body.tags, ['a', 'b']);
    });

    it('leaves json bodies untouched (single-element arrays not collapsed)', async () => {
      const { body } = await postToParser({
        body: JSON.stringify({ token: 'abc', tags: ['x'] }),
        contentType: 'application/json',
      });
      assert.strictEqual(body.token, 'abc');
      assert.deepStrictEqual(body.tags, ['x']);
    });
  });
});

// A request the parser can consume without an HTTP round-trip: a readable body
// plus the headers formidable reads. `contentLength` may lie about the body —
// that is exactly what the declared-length guard checks.
const makeRequest = ({
  body,
  contentType,
  contentLength,
  i18n,
}: {
  body: string;
  contentType: string;
  contentLength?: string;
  i18n?: TI18n;
}) => {
  const req = Readable.from([Buffer.from(body)]) as unknown as FrameworkRequest;
  (req as unknown as { headers: Record<string, string> }).headers = {
    'content-type': contentType,
    'content-length': contentLength ?? String(Buffer.byteLength(body)),
  };
  req.appInfo = {
    app: appInstance,
    request: {},
    query: {},
    params: {},
    i18n,
  };
  req.body = {};
  return req;
};

const runParser = async (
  req: FrameworkRequest,
  params?: Record<string, unknown>,
) => {
  let status = 0;
  let payload: Record<string, unknown> = {};
  const res = {
    status(statusCode: number) {
      status = statusCode;
      return res;
    },
    json(body: Record<string, unknown>) {
      payload = body;
      return res;
    },
    once() {
      return res;
    },
  };
  await new RequestParser(appInstance, params).middleware(
    req,
    res as unknown as Response,
    (() => {}) as NextFunction,
  );
  return { status, payload };
};

/**
 * All three rejection bodies go through `translate()`: an app that ships the
 * `middleware.requestParser.*` keys gets its own wording, an app that does not
 * keeps the exact English text.
 */
describe('request parser message translation', () => {
  const englishTooLarge =
    'Request entity too large. Your upload exceeds the allowed size or count limits.';
  const englishParseError =
    'Error to parse your request. You provided invalid content type or content-length. Please check your request headers and content type.';
  const tooLargeKey = 'middleware.requestParser.entityTooLarge';
  const parseErrorKey = 'middleware.requestParser.parseError';

  const oversizedJson = (i18n?: TI18n) =>
    makeRequest({
      body: '{}',
      contentType: 'application/json',
      contentLength: String(64 * 1024 * 1024),
      i18n,
    });

  const oversizedUpload = (i18n?: TI18n) => {
    const uploadBoundary = 'translationboundary';
    return makeRequest({
      body:
        `--${uploadBoundary}\r\n` +
        `Content-Disposition: form-data; name="upload"; filename="x.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `file-contents-here\r\n` +
        `--${uploadBoundary}--\r\n`,
      contentType: `multipart/form-data; boundary=${uploadBoundary}`,
      i18n,
    });
  };

  const unparsable = (i18n?: TI18n) =>
    makeRequest({ body: 'someBadBody', contentType: 'badContentType', i18n });

  it('413 (declared content-length) keeps the English text without the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runParser(
      oversizedJson(await i18nService.getI18nForLang('en')),
    );

    assert.strictEqual(status, 413);
    assert.deepStrictEqual(payload, { message: englishTooLarge });
  });

  it('413 (declared content-length) uses the app translation', async () => {
    const { status, payload } = await runParser(
      oversizedJson(stubI18n({ [tooLargeKey]: 'Запрос слишком большой' })),
    );

    assert.strictEqual(status, 413);
    assert.deepStrictEqual(payload, { message: 'Запрос слишком большой' });
  });

  it('413 (parser limit) keeps the English text without the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runParser(
      oversizedUpload(await i18nService.getI18nForLang('en')),
      { maxFileSize: 2 },
    );

    assert.strictEqual(status, 413);
    assert.deepStrictEqual(payload, { message: englishTooLarge });
  });

  it('413 (parser limit) uses the app translation', async () => {
    const { status, payload } = await runParser(
      oversizedUpload(stubI18n({ [tooLargeKey]: 'Запрос слишком большой' })),
      { maxFileSize: 2 },
    );

    assert.strictEqual(status, 413);
    assert.deepStrictEqual(payload, { message: 'Запрос слишком большой' });
  });

  it('400 keeps the English text without the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runParser(
      unparsable(await i18nService.getI18nForLang('en')),
    );

    assert.strictEqual(status, 400);
    assert.deepStrictEqual(payload, { message: englishParseError });
  });

  it('400 uses the app translation', async () => {
    const { status, payload } = await runParser(
      unparsable(stubI18n({ [parseErrorKey]: 'Не удалось разобрать запрос' })),
    );

    assert.strictEqual(status, 400);
    assert.deepStrictEqual(payload, { message: 'Не удалось разобрать запрос' });
  });
});
