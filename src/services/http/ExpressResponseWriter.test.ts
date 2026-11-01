import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import express, { type Request, type Response } from 'express';
import type { TransformResponseHook } from '../../server.ts';
import { ExpressResponseWriter } from './ExpressResponseWriter.ts';
import { HttpResponse } from './responses.ts';

const writer = new ExpressResponseWriter();
const bytesOf = (text: string) => new TextEncoder().encode(text);

type Route = (req: Request, res: Response) => unknown;

let server: Server;
let origin: string;
let route: Route;
/** Settles with the error `route` threw (or undefined) once the request is handled. */
let handled: Promise<unknown>;

before(async () => {
  const app = express();
  app.use((req, res) => {
    handled = (async () => {
      try {
        await route(req, res);
        return undefined;
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ writeFailed: true });
        }
        return err;
      }
    })();
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  route = () => {};
});

/** Serve one descriptor: built per request, written through the writer. */
const serve = (make: () => HttpResponse, prepare?: (res: Response) => void) => {
  route = (req, res) => {
    prepare?.(res);
    return writer.write(make(), req, res);
  };
};

const withTimeout = <T>(promise: Promise<T>, label: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out: ${label}`)), 2000),
    ),
  ]);

/** A full garbage collection, where the runtime allows forcing one. */
const forceGc = (): (() => void) | undefined => {
  const bun = (globalThis as { Bun?: { gc(force: boolean): void } }).Bun;
  if (bun) {
    return () => bun.gc(true);
  }
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as (() => void) | undefined;
  return typeof gc === 'function' ? () => gc() : undefined;
};

/** Resolve on the first body byte, then drop the connection. */
const abortAfterFirstChunk = () =>
  new Promise<void>((resolve, reject) => {
    const request = http.get(origin, (response) => {
      response.once('data', () => {
        request.destroy();
        resolve();
      });
    });
    request.on('error', (err) => {
      if ((err as { code?: string }).code !== 'ECONNRESET') {
        reject(err);
      }
    });
  });

describe('ExpressResponseWriter — JSON, text and bytes', () => {
  it('json: same content type, body and ETag as res.json', async () => {
    const body = { id: 'x', list: [1, 2] };
    route = (_req, res) => res.json(body);
    const legacy = await fetch(origin);
    serve(() => HttpResponse.json(200, body));
    const written = await fetch(origin);

    assert.strictEqual(written.status, 200);
    assert.strictEqual(
      written.headers.get('content-type'),
      legacy.headers.get('content-type'),
    );
    assert.strictEqual(written.headers.get('etag'), legacy.headers.get('etag'));
    assert.deepStrictEqual(await written.json(), await legacy.json());
  });

  it('json: custom media type gets the utf-8 charset', async () => {
    serve(() =>
      HttpResponse.json(
        422,
        { title: 'Bad' },
        { contentType: 'application/problem+json' },
      ),
    );
    const response = await fetch(origin);
    assert.strictEqual(response.status, 422);
    assert.strictEqual(
      response.headers.get('content-type'),
      'application/problem+json; charset=utf-8',
    );
    assert.deepStrictEqual(await response.json(), { title: 'Bad' });
  });

  it('text: media type with charset', async () => {
    serve(() =>
      HttpResponse.text(200, '<p>hi</p>', { contentType: 'text/html' }),
    );
    const response = await fetch(origin);
    assert.strictEqual(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    );
    assert.strictEqual(await response.text(), '<p>hi</p>');
  });

  it('bytes: sends exactly the view, not its whole buffer', async () => {
    const view = bytesOf('xxhelloxx').subarray(2, 7);
    serve(() => HttpResponse.bytes(200, view));
    const response = await fetch(origin);
    assert.strictEqual(
      response.headers.get('content-type'),
      'application/octet-stream',
    );
    assert.strictEqual(response.headers.get('content-length'), '5');
    assert.strictEqual(await response.text(), 'hello');
  });

  it('a body JSON cannot encode rejects and restores status and headers', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    serve(
      () =>
        HttpResponse.json(201, circular, {
          headers: { 'set-cookie': 'session=1', 'x-created': 'yes' },
        }),
      (res) => res.setHeader('X-Frame-Options', 'DENY'),
    );
    const response = await fetch(origin);
    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(await response.json(), { writeFailed: true });
    assert.strictEqual(response.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(response.headers.get('x-created'), null);
    assert.deepStrictEqual(response.headers.getSetCookie(), []);
    assert.ok((await handled) instanceof TypeError);
  });

  it('HEAD: headers without a body', async () => {
    serve(() => HttpResponse.json(200, { id: 'x' }));
    const response = await fetch(origin, { method: 'HEAD' });
    assert.strictEqual(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/json/,
    );
    assert.strictEqual(await response.text(), '');
  });
});

describe('ExpressResponseWriter — empty and redirect', () => {
  it('empty: 204 without a body', async () => {
    serve(() => HttpResponse.empty(204, { headers: { 'x-done': '1' } }));
    const response = await fetch(origin);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.headers.get('x-done'), '1');
    assert.strictEqual(await response.text(), '');
  });

  it('empty: 202 answers a zero-length body', async () => {
    serve(() => HttpResponse.empty(202));
    const response = await fetch(origin);
    assert.strictEqual(response.status, 202);
    assert.strictEqual(response.headers.get('content-length'), '0');
  });

  it('redirect: status and location', async () => {
    serve(() => HttpResponse.redirect(303, '/next?a=1'));
    const response = await fetch(origin, { redirect: 'manual' });
    assert.strictEqual(response.status, 303);
    assert.strictEqual(response.headers.get('location'), '/next?a=1');
  });
});

describe('ExpressResponseWriter — headers already on the response', () => {
  it('keeps them, replaces same-name ones, appends cookies, merges vary', async () => {
    serve(
      () =>
        HttpResponse.json(
          200,
          {},
          {
            headers: [
              ['x-frame-options', 'SAMEORIGIN'],
              ['set-cookie', 'b=2'],
              ['set-cookie', 'c=3'],
              ['vary', 'Accept'],
            ],
          },
        ),
      (res) => {
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.append('Set-Cookie', 'a=1');
        res.vary('Origin');
      },
    );
    const response = await fetch(origin);
    assert.strictEqual(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.strictEqual(
      response.headers.get('x-content-type-options'),
      'nosniff',
    );
    assert.deepStrictEqual(response.headers.getSetCookie(), [
      'a=1',
      'b=2',
      'c=3',
    ]);
    assert.strictEqual(response.headers.get('vary'), 'Origin, Accept');
  });
});

describe('ExpressResponseWriter — streams', () => {
  it('ReadableStream, async generator and Node Readable', async () => {
    const sources = [
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytesOf('a'));
            controller.enqueue(bytesOf('b'));
            controller.close();
          },
        }),
      async function* () {
        yield bytesOf('a');
        yield bytesOf('b');
      },
      () => Readable.from([bytesOf('a'), bytesOf('b')]),
    ];
    for (const source of sources) {
      serve(() =>
        HttpResponse.stream(200, source(), { contentType: 'text/csv' }),
      );
      const response = await fetch(origin);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'text/csv');
      assert.strictEqual(await response.text(), 'ab');
      assert.strictEqual(await handled, undefined);
    }
  });

  it('an empty source answers the status with no body', async () => {
    serve(() => HttpResponse.stream(200, (async function* () {})()));
    const response = await fetch(origin);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), '');
  });

  it('an error before the first chunk rejects with nothing sent', async () => {
    const failure = new Error('source failed early');
    serve(() =>
      HttpResponse.stream(
        200,
        // biome-ignore lint/correctness/useYield: fails before yielding
        (async function* () {
          throw failure;
        })(),
      ),
    );
    const response = await fetch(origin);
    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(await response.json(), { writeFailed: true });
    assert.strictEqual(await handled, failure);
  });

  it('an error after the first chunk aborts the response and rejects', async () => {
    const failure = new Error('source failed late');
    serve(() =>
      HttpResponse.stream(
        200,
        (async function* () {
          yield bytesOf('partial');
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw failure;
        })(),
      ),
    );
    const response = await fetch(origin);
    assert.strictEqual(response.status, 200);
    await assert.rejects(response.text());
    assert.strictEqual(await handled, failure);
  });

  it('a client disconnect cancels a ReadableStream', async () => {
    let cancelled: () => void = () => {};
    const wasCancelled = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    serve(() =>
      HttpResponse.stream(
        200,
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytesOf('first'));
          },
          // Never enqueues again: only a cancel ends this stream.
          cancel() {
            cancelled();
          },
        }),
      ),
    );
    await abortAfterFirstChunk();
    await withTimeout(wasCancelled, 'ReadableStream cancel');
    assert.strictEqual(await withTimeout(handled, 'write settles'), undefined);
  });

  it('a client disconnect returns an async generator', async () => {
    let finished: () => void = () => {};
    const ranFinally = new Promise<void>((resolve) => {
      finished = resolve;
    });
    serve(() =>
      HttpResponse.stream(
        200,
        (async function* () {
          try {
            while (true) {
              yield bytesOf('tick');
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          } finally {
            finished();
          }
        })(),
      ),
    );
    await abortAfterFirstChunk();
    await withTimeout(ranFinally, 'generator finally');
    assert.strictEqual(await withTimeout(handled, 'write settles'), undefined);
  });

  it('a disconnect before the first chunk settles the write and stops the source', async () => {
    let nextCalled: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      nextCalled = resolve;
    });
    let returns = 0;
    serve(() =>
      HttpResponse.stream(200, {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            nextCalled();
            // The first chunk never comes: only the disconnect ends this write.
            return new Promise<IteratorResult<Uint8Array>>(() => {});
          },
          return: async () => {
            returns += 1;
            return { done: true as const, value: undefined };
          },
        }),
      }),
    );
    const request = http.get(origin);
    request.on('error', () => {});
    await withTimeout(waiting, 'first next() called');
    request.destroy();
    assert.strictEqual(await withTimeout(handled, 'write settles'), undefined);
    assert.ok(returns >= 1);
  });

  it('a disconnect while a later chunk is pending settles the write', async () => {
    let first = true;
    let returns = 0;
    serve(() =>
      HttpResponse.stream(200, {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (first) {
              first = false;
              return Promise.resolve({ done: false, value: bytesOf('first') });
            }
            return new Promise<IteratorResult<Uint8Array>>(() => {});
          },
          return: async () => {
            returns += 1;
            return { done: true as const, value: undefined };
          },
        }),
      }),
    );
    await abortAfterFirstChunk();
    assert.strictEqual(await withTimeout(handled, 'write settles'), undefined);
    assert.strictEqual(returns, 1);
  });

  it('a large stream arrives whole (backpressure)', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const count = 160; // 10 MiB, well past the socket buffer
    serve(() =>
      HttpResponse.stream(
        200,
        (async function* () {
          for (let i = 0; i < count; i += 1) {
            yield chunk;
          }
        })(),
      ),
    );
    const response = await fetch(origin);
    const body = new Uint8Array(await response.arrayBuffer());
    assert.strictEqual(body.byteLength, chunk.byteLength * count);
    assert.strictEqual(await handled, undefined);
  });

  it('a long open stream does not grow memory per chunk', async () => {
    const collect = forceGc();
    if (!collect) {
      return; // no way to force a collection in this runtime
    }
    const chunk = bytesOf('x'.repeat(16));
    const count = 100_000;
    const heaps: number[] = [];
    serve(() =>
      HttpResponse.stream(
        200,
        (async function* () {
          for (let i = 0; i < count; i += 1) {
            if (i === 5_000 || i === count - 5_000) {
              collect();
              heaps.push(process.memoryUsage().heapUsed);
            }
            yield chunk;
          }
        })(),
      ),
    );
    const response = await fetch(origin);
    // Read and drop each chunk: the client runs in this process and must not hold the body.
    for await (const _ of response.body ?? []) {
      // discard
    }
    await handled;
    const [early = 0, late = 0] = heaps;
    // A reaction kept per chunk adds ≈ 30 MB over these 90 000 chunks.
    assert.ok(
      late - early < 8 * 1024 * 1024,
      `heap grew ${((late - early) / 1024 / 1024).toFixed(1)} MB while streaming`,
    );
  });

  it('a source whose return() throws does not break the disconnect', async () => {
    let first = true;
    serve(() =>
      HttpResponse.stream(200, {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (first) {
              first = false;
              return Promise.resolve({ done: false, value: bytesOf('first') });
            }
            return new Promise<IteratorResult<Uint8Array>>(() => {});
          },
          return: () => {
            throw new Error('return() is broken');
          },
        }),
      }),
    );
    await abortAfterFirstChunk();
    assert.strictEqual(await withTimeout(handled, 'write settles'), undefined);
  });

  it('HEAD cancels the source without reading it', async () => {
    let pulls = 0;
    let cancels = 0;
    serve(() =>
      HttpResponse.stream(
        200,
        new ReadableStream<Uint8Array>(
          {
            pull() {
              pulls += 1;
            },
            cancel() {
              cancels += 1;
            },
          },
          { highWaterMark: 0 },
        ),
      ),
    );
    const response = await fetch(origin, { method: 'HEAD' });
    await handled;
    assert.strictEqual(response.status, 200);
    assert.strictEqual(pulls, 0);
    assert.strictEqual(cancels, 1);
  });
});

describe('ExpressResponseWriter — native Web Response', () => {
  it('sends status, status text, headers, cookies and body', async () => {
    serve(() =>
      HttpResponse.native(
        new Response('made', {
          status: 201,
          statusText: 'Made',
          headers: [
            ['content-type', 'text/plain'],
            ['set-cookie', 'a=1'],
            ['set-cookie', 'b=2'],
            ['x-upstream', 'yes'],
          ],
        }),
      ),
    );
    const response = await fetch(origin);
    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.statusText, 'Made');
    assert.strictEqual(response.headers.get('content-type'), 'text/plain');
    assert.strictEqual(response.headers.get('x-upstream'), 'yes');
    assert.deepStrictEqual(response.headers.getSetCookie(), ['a=1', 'b=2']);
    assert.strictEqual(await response.text(), 'made');
  });

  it('drops framing headers the server sets itself', async () => {
    serve(() =>
      HttpResponse.native(
        new Response('x', {
          headers: { 'transfer-encoding': 'gzip', connection: 'upgrade' },
        }),
      ),
    );
    const response = await fetch(origin);
    assert.strictEqual(await response.text(), 'x');
    assert.notStrictEqual(response.headers.get('connection'), 'upgrade');
  });

  it('a Response without a body', async () => {
    serve(() => HttpResponse.native(new Response(null, { status: 204 })));
    const response = await fetch(origin);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(await response.text(), '');
  });
});

describe('ExpressResponseWriter — transform', () => {
  const envelope: TransformResponseHook = (response) =>
    response.kind === 'json'
      ? HttpResponse.json(
          response.status,
          { data: response.body },
          { headers: response.headers, contentType: response.contentType },
        )
      : response;

  /** Serve one descriptor through a writer built with `transform`. */
  const serveWith = (
    transform: TransformResponseHook,
    make: () => HttpResponse,
  ) => {
    const reported: string[] = [];
    const transforming = new ExpressResponseWriter({
      transform,
      onTransformError: (message) => reported.push(message),
    });
    route = (req, res) => transforming.write(make(), req, res);
    return reported;
  };

  it('sends what the transform returns', async () => {
    const reported = serveWith(envelope, () =>
      HttpResponse.json(201, { id: 'x' }, { headers: { 'x-id': 'x' } }),
    );
    const response = await fetch(origin);
    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.headers.get('x-id'), 'x');
    assert.deepStrictEqual(await response.json(), { data: { id: 'x' } });
    assert.deepStrictEqual(reported, []);
  });

  it('passes the request and leaves other kinds to the transform', async () => {
    let seenPath = '';
    serveWith(
      (response, { req }) => {
        seenPath = req.path;
        return envelope(response, { req });
      },
      () => HttpResponse.text(200, 'plain'),
    );
    const response = await fetch(`${origin}/seen`);
    assert.strictEqual(await response.text(), 'plain');
    assert.strictEqual(seenPath, '/seen');
  });

  it('cancels a stream the transform replaced, keeps one it re-wrapped', async () => {
    let cancels = 0;
    const source = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytesOf('body'));
          controller.close();
        },
        cancel() {
          cancels += 1;
        },
      });
    serveWith(
      (response) =>
        response.kind === 'stream' ? HttpResponse.empty(204) : response,
      () => HttpResponse.stream(200, source()),
    );
    const replaced = await fetch(origin);
    await handled;
    assert.strictEqual(replaced.status, 204);
    assert.strictEqual(cancels, 1);

    serveWith(
      (response) =>
        response.kind === 'stream'
          ? HttpResponse.stream(response.status, response.body, {
              headers: { 'x-wrapped': '1' },
            })
          : response,
      () => HttpResponse.stream(200, source()),
    );
    const rewrapped = await fetch(origin);
    assert.strictEqual(rewrapped.headers.get('x-wrapped'), '1');
    assert.strictEqual(await rewrapped.text(), 'body');
    await handled;
    assert.strictEqual(cancels, 1);
  });

  it('sends the original and reports a transform that throws', async () => {
    const reported = serveWith(
      () => {
        throw new Error('envelope broke');
      },
      () => HttpResponse.json(200, { id: 'x' }),
    );
    const response = await fetch(origin);
    assert.deepStrictEqual(await response.json(), { id: 'x' });
    assert.strictEqual(reported.length, 1);
    assert.match(reported[0] ?? '', /transformResponse threw.*envelope broke/s);
  });

  it('sends the original and reports a transform that returns no response', async () => {
    const asyncTransform = (async (response: HttpResponse) =>
      response) as unknown as TransformResponseHook;
    const reported = serveWith(asyncTransform, () =>
      HttpResponse.json(200, { id: 'x' }),
    );
    const response = await fetch(origin);
    assert.deepStrictEqual(await response.json(), { id: 'x' });
    assert.match(
      reported[0] ?? '',
      /returned a Promise \(it must be synchronous\)/,
    );
  });
});
