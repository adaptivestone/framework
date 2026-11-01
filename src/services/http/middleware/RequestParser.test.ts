import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import type { NextFunction, Response } from 'express';
import express from 'express';
import { PersistentFile } from 'formidable';
import { appInstance } from '../../../helpers/appInstance.ts';
import {
  createTestContext,
  finishTestContext,
} from '../../../tests/createTestContext.ts';
import { stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import { ExpressResponseWriter } from '../ExpressResponseWriter.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { HttpError } from '../httpErrors.ts';
import { HttpResponse } from '../responses.ts';
import { expressMiddleware } from '../routing/expressPipeline.ts';
import RequestParser from './RequestParser.ts';

type Headers = Record<string, string | string[] | undefined>;
const baseAppInfo = () => ({
  app: appInstance,
  request: {},
  query: {},
  params: {},
});

/**
 * Run the parser on a context over `incoming`. Resolves to the outcome: 200
 * with the parsed body, or the thrown `HttpError`'s status, code and message.
 */
const parseWith = async (
  incoming: NodeJS.ReadableStream & { headers: Headers },
  params?: Record<string, unknown>,
  appInfo: Record<string, unknown> = baseAppInfo(),
) => {
  const ctx = createTestContext({
    method: 'POST',
    headers: incoming.headers,
    incoming,
    body: {},
    appInfo,
  });
  try {
    await new RequestParser(appInstance, params).middleware(ctx, async () =>
      HttpResponse.empty(204),
    );
    return { ctx, status: 200, body: ctx.body as Record<string, unknown> };
  } catch (err) {
    if (!(err instanceof HttpError)) {
      throw err;
    }
    return {
      ctx,
      status: err.status,
      code: err.code,
      payload: { message: err.message },
      body: ctx.body as Record<string, unknown>,
    };
  }
};

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
// status + parsed body. The context is finished when the response ends, so the
// temp-file cleanup (an `onFinish` callback) actually runs.
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
      const outcome = await parseWith(
        req as IncomingMessage & { headers: Headers },
        params,
      );
      res.once('close', () => finishTestContext(outcome.ctx));
      result = { status: outcome.status, body: outcome.body };
      res.writeHead(outcome.status);
      res.end(outcome.status === 200 ? 'ok' : '{}');
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
    const formBoundary = '--13068458571765726332503797717';
    const { status, body } = await postToParser({
      body:
        `--${formBoundary}\r\n` +
        'Content-Disposition: form-data; name="title"\r\n\r\na\r\n' +
        `--${formBoundary}\r\n` +
        'Content-Disposition: form-data; name="multipleFiles"; filename="x.txt"\r\n' +
        'Content-Type: application/x-javascript\r\n\r\n\r\n\r\na\r\nb\r\nc\r\nd\r\n\r\n' +
        `--${formBoundary}--\r\n`,
      contentType: `multipart/form-data; boundary=${formBoundary}`,
    });

    assert.strictEqual(status, 200);
    assert.notStrictEqual(body.title, undefined);
    const files = body.multipleFiles as unknown[];
    assert.ok(files[0] instanceof PersistentFile);
  });

  it('middleware with a problem', async () => {
    const { status } = await postToParser({
      body: 'someBadBody',
      contentType: 'badContentType',
    });
    // The rejection is thrown for the error handlers to answer.
    assert.strictEqual(status, 400);
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

const runParser = (req: FrameworkRequest, params?: Record<string, unknown>) =>
  parseWith(
    req as unknown as NodeJS.ReadableStream & { headers: Headers },
    params,
    req.appInfo as unknown as Record<string, unknown>,
  );

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
    const { status, code, payload } = await runParser(
      oversizedJson(await i18nService.getI18nForLang('en')),
    );

    assert.strictEqual(status, 413);
    assert.strictEqual(code, 'PAYLOAD_TOO_LARGE');
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
    const { status, code, payload } = await runParser(
      unparsable(await i18nService.getI18nForLang('en')),
    );

    assert.strictEqual(status, 400);
    assert.strictEqual(code, 'MALFORMED_BODY');
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

describe('request parser media-type isolation', () => {
  it('enforces declared limits when JSON parameters contain multipart', async () => {
    const result = await postToParser({
      body: JSON.stringify({ value: 'x'.repeat(100) }),
      contentType: 'application/json; note=multipart',
      params: { maxFieldsSize: 32 },
    });
    assert.strictEqual(result.status, 413);
    assert.deepStrictEqual(result.body, {});
  });

  it('parses bounded JSON regardless of misleading header parameters', async () => {
    for (const contentType of [
      'application/json; note=multipart',
      'APPLICATION/JSON; charset=utf-8',
    ]) {
      const result = await postToParser({ body: '{"ok":true}', contentType });
      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(result.body, { ok: true });
    }
  });

  it('keeps multipart boundaries containing json on the multipart parser', async () => {
    const result = await postToParser({
      body: multipartBody.replaceAll(boundary, 'boundary-json'),
      contentType: 'MULTIPART/FORM-DATA; boundary=boundary-json',
      params: { maxFieldsSize: 8 },
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.title, 'hello');
    assert.ok(result.body.upload);
  });

  it('bounds streamed JSON even without a declared length', async () => {
    const req = makeRequest({
      body: JSON.stringify({ value: 'x'.repeat(100) }),
      contentType: 'application/json; note=multipart',
    });
    delete req.headers['content-length'];
    req.headers['transfer-encoding'] = 'chunked';
    const result = await runParser(req, { maxFieldsSize: 32 });
    assert.strictEqual(result.status, 413);
    assert.deepStrictEqual(result.body, {});
  });

  it('answers an oversized streamed body with 413, not a connection reset', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as FrameworkRequest).appInfo = {
        app: appInstance,
        request: {},
        query: {},
        params: {},
      };
      next();
    });
    app.use(
      expressMiddleware(
        appInstance,
        new ExpressResponseWriter(),
        new RequestParser(appInstance, { maxFieldsSize: 32 }),
      ),
    );
    app.use((_req, res) => {
      res.json({ ok: true });
    });
    // Answer at once like the framework's final sink: Express's default
    // handler would first drain the unread (endless) body.
    app.use(
      (err: HttpError, _req: unknown, res: Response, _next: NextFunction) => {
        res.status(err.status).json({ message: err.message });
      },
    );
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const response = await new Promise<{ status?: number; close?: string }>(
        (resolve, reject) => {
          const clientReq = request(
            {
              port,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
              res.resume();
              resolve({
                status: res.statusCode,
                close: res.headers.connection,
              });
            },
          );
          // Keep streaming (chunked, no length) past the limit until answered.
          const writer = setInterval(() => clientReq.write('x'.repeat(64)), 5);
          clientReq.on('response', () => {
            clearInterval(writer);
            clientReq.destroy();
          });
          clientReq.on('close', () => clearInterval(writer));
          clientReq.on('error', reject);
          clientReq.write('{"value":"');
        },
      );
      assert.deepStrictEqual(response, { status: 413, close: 'close' });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('request parser modes', () => {
  it("'raw' is bounded like a parsed body; 'none' does not read the stream", async () => {
    const tooBig = makeRequest({
      body: 'x'.repeat(64),
      contentType: 'application/octet-stream',
    });
    const raw = await runParser(tooBig, {
      bodyParsing: 'raw',
      maxFieldsSize: 8,
    });
    assert.strictEqual(raw.status, 413);

    const untouched = makeRequest({
      body: '{"a":1}',
      contentType: 'application/json',
    });
    const none = await runParser(untouched, { bodyParsing: 'none' });
    assert.strictEqual(none.status, 200);
    assert.deepStrictEqual(none.body, {});
    assert.strictEqual((untouched as unknown as Readable).readableEnded, false);
  });
});
