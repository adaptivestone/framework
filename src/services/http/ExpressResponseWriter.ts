import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { TransformResponseHook } from '../../server.ts';
import type { FrameworkRequest } from './HttpServer.ts';
import type { ResponseWriter } from './ResponseWriter.ts';
import {
  type ByteStream,
  HttpResponse,
  type ResponseHeaders,
} from './responses.ts';

export interface ExpressResponseWriterOptions {
  /** Applied to every response before it is written (`transformResponse`). */
  transform?: TransformResponseHook;
  /** Told when `transform` throws or returns no response; the original is sent. */
  onTransformError?: (message: string) => void;
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

  constructor(options: ExpressResponseWriterOptions = {}) {
    this.#transform = options.transform;
    this.#onTransformError = options.onTransformError ?? (() => {});
  }

  async write(
    response: HttpResponse,
    req: Request,
    res: Response,
  ): Promise<void> {
    const { statusCode, statusMessage } = res;
    const headers = res.getHeaders();
    try {
      await render(this.#transformed(response, req), req, res);
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
      // Typed as a response, but it is project code: check what came back.
      const transformed: unknown = this.#transform(response, {
        req: req as FrameworkRequest,
      });
      if (HttpResponse.is(transformed)) {
        return transformed;
      }
      const got =
        transformed instanceof Promise
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

/**
 * Send a byte source. Nothing is committed until the first chunk arrives, so
 * an error before it rejects with `res` untouched. After that, an error
 * destroys the response and rejects. A client disconnect stops the source
 * and resolves.
 */
async function writeStream(
  req: Request,
  res: Response,
  body: ByteStream,
  commit: () => void,
): Promise<void> {
  const source = iterate(body);
  const stop = () => {
    Promise.resolve(source.return?.()).catch(() => {});
  };
  if (req.method === 'HEAD') {
    stop();
    commit();
    res.end();
    return;
  }
  res.once('close', stop);
  try {
    const first = await source.next();
    if (res.destroyed) {
      return;
    }
    commit();
    if (first.done) {
      res.end();
      return;
    }
    res.write(first.value);
    await pipeline({ [Symbol.asyncIterator]: () => source }, res);
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ERR_STREAM_PREMATURE_CLOSE') {
      return;
    }
    throw err;
  } finally {
    res.off('close', stop);
  }
}
