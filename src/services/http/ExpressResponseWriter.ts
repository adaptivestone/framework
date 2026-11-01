import type { Request, Response } from 'express';
import type { TransformResponseHook } from '../../server.ts';
import type { FrameworkRequest } from './HttpServer.ts';
import type { RequestContext } from './RequestContext.ts';
import type { ResponseWriter } from './ResponseWriter.ts';
import {
  type ByteStream,
  HttpResponse,
  type ResponseHeaders,
} from './responses.ts';
import { expressContext } from './routing/expressPipeline.ts';

export interface ExpressResponseWriterOptions {
  /** Applied to every response before it is written (`transformResponse`). */
  transform?: TransformResponseHook;
  /** Told when `transform` throws or returns no response; the original is sent. */
  onTransformError?: (message: string) => void;
  /** The request's context for `transform` (default: one per request, without an app logger). */
  context?: (req: Request) => RequestContext;
}

/** Framing headers Node sets itself; a native response's copies are dropped. */
const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Renders `HttpResponse` values through Express, so JSON, text and bytes get
 * the same serialization, `ETag` and conditional-GET handling as `res.json` /
 * `res.send`. Headers the request already carries (security headers, CORS)
 * stay: a descriptor header replaces one of the same name, except
 * `set-cookie` (appended) and `vary` (merged). A write that fails before
 * anything is sent (a body `JSON.stringify` rejects, a stream that fails
 * before its first chunk) restores the status and headers it found, so the
 * error response that follows carries none of the descriptor's.
 */
export class ExpressResponseWriter
  implements ResponseWriter<Request, Response>
{
  readonly #transform?: TransformResponseHook;

  readonly #onTransformError: (message: string) => void;

  readonly #context: (req: Request) => RequestContext;

  constructor(options: ExpressResponseWriterOptions = {}) {
    this.#transform = options.transform;
    this.#onTransformError = options.onTransformError ?? (() => {});
    this.#context =
      options.context ?? ((req) => expressContext(undefined, req));
  }

  async write(
    response: HttpResponse,
    req: Request,
    res: Response,
  ): Promise<void> {
    if (response.kind === 'sent') {
      // Already written through `res` by 5.x code; nothing to transform or send.
      return;
    }
    const { statusCode, statusMessage } = res;
    const headers = res.getHeaders();
    try {
      const final = this.#transformed(response, req);
      if (final !== response) {
        discardReplacedBody(response, final);
      }
      await render(final, req, res);
    } catch (err) {
      if (!res.headersSent) {
        for (const name of res.getHeaderNames()) {
          res.removeHeader(name);
        }
        for (const [name, value] of Object.entries(headers)) {
          if (value !== undefined) {
            res.setHeader(name, value);
          }
        }
        res.statusCode = statusCode;
        res.statusMessage = statusMessage;
      }
      throw err;
    }
  }

  /** A broken transform must not take the API down: report it, send the original. */
  #transformed(response: HttpResponse, req: Request): HttpResponse {
    if (!this.#transform) {
      return response;
    }
    try {
      const context = this.#context;
      // Typed as a response, but it is project code: check what came back.
      const transformed: unknown = this.#transform(response, {
        req: req as FrameworkRequest,
        // Read lazily: a transform that never looks at `ctx` costs nothing.
        get ctx() {
          const ctx = context(req);
          // The response is being written: change the returned one instead.
          ctx.response.seal();
          return ctx;
        },
      });
      if (HttpResponse.is(transformed)) {
        return transformed;
      }
      const got =
        typeof (transformed as { then?: unknown } | null)?.then === 'function'
          ? 'a Promise (it must be synchronous)'
          : transformed === null
            ? 'null'
            : typeof transformed;
      this.#onTransformError(
        `transformResponse returned ${got}, not an HttpResponse; the original response was sent`,
      );
    } catch (err) {
      this.#onTransformError(
        `transformResponse threw; the original response was sent: ${
          err instanceof Error ? (err.stack ?? err.message) : err
        }`,
      );
    }
    return response;
  }
}

async function render(
  response: HttpResponse,
  req: Request,
  res: Response,
): Promise<void> {
  switch (response.kind) {
    case 'json':
      start(res, response.status, response.headers);
      res.setHeader('Content-Type', response.contentType);
      res.json(response.body);
      return;
    case 'text':
      start(res, response.status, response.headers);
      res.setHeader('Content-Type', response.contentType);
      res.send(response.body);
      return;
    case 'bytes': {
      start(res, response.status, response.headers);
      res.setHeader('Content-Type', response.contentType);
      const { body } = response;
      // `res.send` serializes anything but a Buffer as JSON.
      res.send(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
      return;
    }
    case 'empty':
      start(res, response.status, response.headers);
      res.end();
      return;
    case 'redirect':
      applyHeaders(res, response.headers);
      res.redirect(response.status, response.location);
      return;
    case 'stream':
      return writeStream(req, res, response.body, () => {
        start(res, response.status, response.headers);
        res.setHeader('Content-Type', response.contentType);
      });
    case 'native': {
      const native = response.response;
      const commit = () => {
        start(
          res,
          native.status,
          [...native.headers].filter(([name]) => !HOP_BY_HOP_HEADERS.has(name)),
        );
        if (native.statusText) {
          res.statusMessage = native.statusText;
        }
      };
      if (!native.body) {
        commit();
        res.end();
        return;
      }
      return writeStream(req, res, native.body, commit);
    }
    case 'sent':
      // A transform that returned an already-sent response: nothing to write.
      return;
  }
}

function start(res: Response, status: number, headers: ResponseHeaders): void {
  res.status(status);
  applyHeaders(res, headers);
}

function applyHeaders(res: Response, headers: ResponseHeaders): void {
  for (const [name, value] of headers) {
    if (name === 'set-cookie') {
      res.append('Set-Cookie', value);
    } else if (name === 'vary') {
      res.vary(value);
    } else {
      res.setHeader(name, value);
    }
  }
}

/** The byte source a response would read, if any. */
function bodySource(response: HttpResponse): ByteStream | undefined {
  if (response.kind === 'stream') {
    return response.body;
  }
  if (response.kind === 'native') {
    return response.response.body ?? undefined;
  }
  return undefined;
}

/** A transform that replaced a streaming response: stop the source it dropped. */
function discardReplacedBody(
  original: HttpResponse,
  replacement: HttpResponse,
): void {
  const dropped = bodySource(original);
  if (dropped && dropped !== bodySource(replacement)) {
    cancelSource(dropped);
  }
}

/** Stop a byte source that will not be read. A failure to stop is ignored. */
function cancelSource(body: ByteStream): void {
  try {
    const stopped =
      body instanceof ReadableStream
        ? body.cancel()
        : body[Symbol.asyncIterator]().return?.();
    Promise.resolve(stopped).catch(() => {});
  } catch {
    // A source that throws while stopping is already broken; nothing more to do.
  }
}

/** A `ReadableStream` read through its reader, so a disconnect cancels a pending read at once. */
function iterate(body: ByteStream): AsyncIterator<Uint8Array> {
  if (body instanceof ReadableStream) {
    const reader = body.getReader();
    return {
      next: () => reader.read() as Promise<IteratorResult<Uint8Array>>,
      return: async () => {
        await reader.cancel();
        return { done: true, value: undefined };
      },
    };
  }
  return body[Symbol.asyncIterator]();
}

const DISCONNECTED = Symbol('disconnected');

/**
 * Send a byte source. Nothing is committed until the first chunk arrives, so
 * an error before it rejects with `res` untouched. After that, an error
 * destroys the response and rejects. A client disconnect stops the source
 * and resolves, also while a chunk is still pending — Node's `pipeline` keeps
 * waiting on a pending read after the client has gone, so each read is raced
 * against the disconnect here.
 */
async function writeStream(
  req: Request,
  res: Response,
  body: ByteStream,
  commit: () => void,
): Promise<void> {
  const source = iterate(body);
  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      Promise.resolve(source.return?.()).catch(() => {});
    } catch {
      // A source that throws while stopping is already broken; nothing more to do.
    }
  };
  if (req.method === 'HEAD' || res.destroyed) {
    stop();
    if (!res.destroyed) {
      commit();
      res.end();
    }
    return;
  }
  // One short-lived waiter per wait (read or drain), released when that wait ends. A single
  // shared "closed" promise would keep one reaction per chunk alive until the client leaves,
  // so a long stream would grow without bound.
  let gone = false;
  let wake: ((value: typeof DISCONNECTED) => void) | undefined;
  const untilClosed = () =>
    gone
      ? Promise.resolve(DISCONNECTED)
      : new Promise<typeof DISCONNECTED>((resolve) => {
          wake = resolve;
        });
  /** Wait for `work` or the disconnect, whichever comes first. */
  const orClosed = async <T>(
    work: Promise<T>,
  ): Promise<T | typeof DISCONNECTED> => {
    try {
      return await Promise.race([work, untilClosed()]);
    } finally {
      wake = undefined;
    }
  };
  const onClose = () => {
    gone = true;
    stop();
    wake?.(DISCONNECTED);
  };
  // A transport error is followed by 'close', which ends the write.
  const onError = () => {};
  res.once('close', onClose);
  res.on('error', onError);
  /** The next chunk, or `undefined` once the client has gone. */
  const read = async (): Promise<IteratorResult<Uint8Array> | undefined> => {
    const pending = source.next();
    const step = await orClosed(Promise.resolve(pending));
    if (step === DISCONNECTED || res.destroyed) {
      // The chunk may still arrive (or fail) later; nobody reads it.
      Promise.resolve(pending).catch(() => {});
      stop();
      return undefined;
    }
    return step;
  };
  try {
    let step = await read();
    if (!step) {
      return;
    }
    commit();
    while (!step.done) {
      if (!res.write(step.value)) {
        const drained = await orClosed(once(res, 'drain'));
        if (drained === DISCONNECTED) {
          return;
        }
      }
      step = await read();
      if (!step) {
        return;
      }
    }
    res.end();
  } catch (err) {
    if (res.headersSent) {
      stop();
      res.destroy();
    }
    throw err;
  } finally {
    res.off('close', onClose);
    res.off('error', onError);
  }
}

/** Resolves on the first `event`; the caller races it against the disconnect. */
function once(res: Response, event: 'drain'): Promise<void> {
  return new Promise((resolve) => {
    res.once(event, () => resolve());
  });
}
