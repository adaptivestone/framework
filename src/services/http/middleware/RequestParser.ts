import { unlink } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import formidable, {
  json,
  multipart,
  octetstream,
  querystring,
} from 'formidable';
import type ThttpConfig from '../../../config/http.ts';
import { normalizeContentType } from '../../validate/contentType.ts';
import { FRAMEWORK_ERROR_CODES, HttpError } from '../httpErrors.ts';
import { type Next, RequestContext } from '../RequestContext.ts';
import type { BodyParsingMode } from '../routing/RouteNode.ts';
import Middleware from './Middleware.ts';

/** Does the request carry a body at all (a length above zero, or chunked)? */
function hasBody(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): boolean {
  const length = Number(headers['content-length']);
  return (
    (Number.isFinite(length) && length > 0) ||
    headers['transfer-encoding'] !== undefined
  );
}

/**
 * Parses multipart / urlencoded / json request bodies (via formidable) into
 * `ctx.body` (`req.body`). The framework runs it first on every matched route,
 * after routing, in the route's `bodyParsing` mode (`params.bodyParsing`):
 * `'parsed'` (default) parses; `'raw'` captures the bytes into `req.rawBody`
 * and leaves the body unparsed; `'none'` leaves the request untouched. Size
 * and count limits come from `config.http.requestParser` (explicit params
 * override them). Spooled upload temp files are unlinked once the response
 * ends — a handler that needs to keep an upload MUST move or copy it (e.g.
 * `fs.rename`) before responding. An oversized body (413) or an unparsable one
 * (400) is thrown as an `HttpError`, so the error-handler registry answers it.
 */
class RequestParser extends Middleware {
  static get description() {
    return 'Parses incoming request. Based on Formidable library';
  }

  async middleware(ctx: RequestContext<object>, next: Next) {
    await this.parse(ctx);
    return next();
  }

  /** Read the body in this parser's `bodyParsing` mode; throws a 413 or 400 `HttpError`. */
  async parse(ctx: RequestContext<object>): Promise<void> {
    const { bodyParsing, ...params } = (this.params ?? {}) as {
      bodyParsing?: BodyParsingMode;
    };
    const mode = bodyParsing ?? 'parsed';
    const req = RequestContext.incoming(ctx) as IncomingMessage | undefined;
    if (mode === 'none' || !req) {
      return;
    }
    const { requestParser } = this.app.getConfig('http') as typeof ThttpConfig;
    // Config defaults bound unauthenticated uploads; explicit per-mount params win.
    const parserOptions = { ...requestParser, ...params };
    const maxBodySize =
      typeof parserOptions.maxFieldsSize === 'number'
        ? parserOptions.maxFieldsSize
        : 2 * 1024 * 1024;
    if (mode === 'raw') {
      RequestContext.setRawBody(
        ctx,
        await this.#readRaw(ctx, req, maxBodySize),
      );
      return;
    }
    if (!hasBody(ctx.headers)) {
      // Nothing to parse (a GET, an empty POST): the same `{}` formidable gives.
      RequestContext.setBody(ctx, { ...((ctx.body as object) ?? {}) });
      return;
    }
    const time = Date.now();
    this.logger?.verbose(`Parsing request`);
    const mediaType = normalizeContentType(ctx.header('content-type'));
    const isMultipart =
      mediaType === 'multipart/form-data' || mediaType === 'multipart/related';
    // Formidable's default plugins inspect the entire header. Select one for
    // known media types so parameter text cannot switch the parser.
    const plugin = isMultipart
      ? multipart
      : mediaType === 'application/json' || mediaType?.endsWith('+json')
        ? json
        : mediaType === 'application/x-www-form-urlencoded'
          ? querystring
          : mediaType === 'application/octet-stream'
            ? octetstream
            : undefined;
    const form = formidable({
      ...parserOptions,
      ...(plugin ? { enabledPlugins: [plugin] } : {}),
    });

    // JSON/urlencoded parsing buffers the body (bounded by `maxBodySize`);
    // multipart has its own field and file limits. Unknown media types retain
    // the v5 fallback, bounded below.
    let bodyTooLarge = false;
    if (!isMultipart) {
      this.#assertDeclaredLength(ctx, maxBodySize);
    }
    // Also guard chunked bodies. Only a genuinely selected multipart parser
    // may rely on the separate file/field limits. Pausing (not destroying) the
    // request keeps the socket writable, so the client receives the 413; its
    // `Connection: close` then ends the connection.
    let rejectOversized: (reason: Error) => void = () => {};
    const oversized = new Promise<never>((_resolve, reject) => {
      rejectOversized = reject;
    });
    form.on('progress', (bytesReceived: number) => {
      if (
        !bodyTooLarge &&
        (form as unknown as { type?: string }).type !== 'multipart' &&
        bytesReceived > maxBodySize
      ) {
        bodyTooLarge = true;
        req.pause();
        rejectOversized(new Error('Request body exceeds maxFieldsSize'));
      }
    });

    // Track every temp file formidable opens (via fileBegin, so a file that
    // later errors mid-write is tracked too) and unlink them once the response
    // is done — on 'finish' (success) and 'close' (aborted). Without this,
    // spooled files accumulate in the temp dir forever → disk exhaustion.
    const openedFiles: Array<{ filepath: string }> = [];
    form.on('fileBegin', (_name, file) => {
      openedFiles.push(file as unknown as { filepath: string });
    });
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      for (const file of openedFiles) {
        unlink(file.filepath).catch(() => {});
      }
    };
    // Once the response has ended: finished, aborted or failed alike.
    ctx.onFinish(cleanup);

    let fields: formidable.Fields<string>;
    let files: formidable.Files<string>;
    try {
      [fields, files] = await Promise.race([form.parse(req), oversized]);
      // Pausing the stream cannot cancel a chunk already inside the parser.
      // Even if that chunk completes parsing, an oversized body must not advance.
      if (bodyTooLarge) {
        throw new Error('Request body exceeds maxFieldsSize');
      }
    } catch (err) {
      this.logger?.error(`Parsing failed ${err}`);
      // formidable tags limit-exceeded errors (file/field size, file/field
      // count) with httpCode 413; our own JSON/urlencoded body-size guard sets
      // `bodyTooLarge`. Everything else (bad content type / length) stays a 400.
      if (bodyTooLarge || (err as { httpCode?: number })?.httpCode === 413) {
        if (bodyTooLarge) {
          // The rest of the body stays unread; close rather than drain it.
          ctx.response.setHeader('connection', 'close');
        }
        throw this.#entityTooLarge(ctx);
      }
      throw new HttpError(400, {
        code: FRAMEWORK_ERROR_CODES.malformedBody,
        message: this.translate(
          ctx,
          'middleware.requestParser.parseError',
          `Error to parse your request. You provided invalid content type or content-length. Please check your request headers and content type.`,
        ),
      });
    }
    this.logger?.verbose(
      `Parsing multipart/formdata request DONE ${Date.now() - time}ms`,
    );

    // formidable wraps multipart/urlencoded fields in arrays (one entry per
    // occurrence) while json keeps the parsed shape. Collapse single-element
    // arrays for the array-wrapping types so a single value lands as a scalar
    // (matching json) — fixes consumers like GetUserByToken that do
    // `token.replace(...)`. Repeated keys stay arrays; json is left untouched;
    // files are not normalized.
    const arrayWrapped =
      (form as unknown as { type?: string }).type === 'multipart' ||
      (form as unknown as { type?: string }).type === 'urlencoded';
    const normalizedFields = arrayWrapped
      ? Object.fromEntries(
          Object.entries(fields).map(([key, value]) =>
            Array.isArray(value) && value.length === 1
              ? [key, value[0]]
              : [key, value],
          ),
        )
      : fields;

    RequestContext.setBody(ctx, {
      // todo avoid body in next versions
      ...((ctx.body as object) || {}),
      ...normalizedFields,
      ...files,
    });
  }

  /** A declared length above the limit is refused before anything is read. */
  #assertDeclaredLength(ctx: RequestContext<object>, maxBodySize: number) {
    const declaredLength = Number(ctx.header('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBodySize) {
      this.logger?.error(
        `Request body ${declaredLength}B exceeds maxFieldsSize ${maxBodySize}B`,
      );
      // Close after the 413 instead of draining the unread body.
      ctx.response.setHeader('connection', 'close');
      throw this.#entityTooLarge(ctx);
    }
  }

  /** The bytes of a `bodyParsing: 'raw'` route, bounded like a parsed body. */
  async #readRaw(
    ctx: RequestContext<object>,
    req: IncomingMessage,
    maxBodySize: number,
  ): Promise<Buffer> {
    this.#assertDeclaredLength(ctx, maxBodySize);
    if (!hasBody(ctx.headers)) {
      return Buffer.alloc(0);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBodySize) {
        // Pausing (not destroying) keeps the socket writable for the 413.
        req.pause();
        ctx.response.setHeader('connection', 'close');
        throw this.#entityTooLarge(ctx);
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }

  #entityTooLarge(ctx: RequestContext<object>) {
    return new HttpError(413, {
      code: FRAMEWORK_ERROR_CODES.payloadTooLarge,
      message: this.translate(
        ctx,
        'middleware.requestParser.entityTooLarge',
        'Request entity too large. Your upload exceeds the allowed size or count limits.',
      ),
    });
  }
}

export default RequestParser;
