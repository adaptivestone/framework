import { unlink } from 'node:fs/promises';
import type { NextFunction, Response } from 'express';
import formidable, {
  json,
  multipart,
  octetstream,
  querystring,
} from 'formidable';
import type ThttpConfig from '../../../config/http.ts';
import { normalizeContentType } from '../../validate/contentType.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

/**
 * Parses multipart / urlencoded / json request bodies (via formidable) into
 * `req.body`. Size and count limits come from `config.http.requestParser`
 * (explicit per-mount params override them). Spooled upload temp files are
 * unlinked once the response finishes — a handler that needs to keep an upload
 * MUST move or copy it (e.g. `fs.rename`) before responding.
 */
class RequestParser extends AbstractMiddleware {
  static get description() {
    return 'Parses incoming request. Based on Formidable library';
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    const time = Date.now();
    this.logger?.verbose(`Parsing request`);

    const { requestParser } = this.app.getConfig('http') as typeof ThttpConfig;
    // Config defaults bound unauthenticated uploads; explicit per-mount params win.
    const parserOptions = { ...requestParser, ...this.params };
    const mediaType = normalizeContentType(req.headers?.['content-type']);
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

    // JSON/urlencoded parsing buffers the body; multipart has its own field
    // and file limits. Unknown media types retain the v5 fallback, bounded below.
    const maxBodySize =
      typeof parserOptions.maxFieldsSize === 'number'
        ? parserOptions.maxFieldsSize
        : 2 * 1024 * 1024;
    let bodyTooLarge = false;
    if (!isMultipart) {
      const declaredLength = Number(req.headers?.['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > maxBodySize) {
        this.logger?.error(
          `Request body ${declaredLength}B exceeds maxFieldsSize ${maxBodySize}B`,
        );
        return res.status(413).json({
          message: this.translate(
            req,
            'middleware.requestParser.entityTooLarge',
            'Request entity too large. Your upload exceeds the allowed size or count limits.',
          ),
        });
      }
    }
    // Also guard chunked bodies. Only a genuinely selected multipart parser
    // may rely on the separate file/field limits.
    form.on('progress', (bytesReceived: number) => {
      if (
        (form as unknown as { type?: string }).type !== 'multipart' &&
        bytesReceived > maxBodySize
      ) {
        bodyTooLarge = true;
        req.destroy();
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
    res.once('finish', cleanup);
    res.once('close', cleanup);

    let fields: formidable.Fields<string>;
    let files: formidable.Files<string>;
    try {
      [fields, files] = await form.parse(req);
      // Destroying the stream cannot cancel a chunk already inside the parser.
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
        return res.status(413).json({
          message: this.translate(
            req,
            'middleware.requestParser.entityTooLarge',
            'Request entity too large. Your upload exceeds the allowed size or count limits.',
          ),
        });
      }
      return res.status(400).json({
        message: this.translate(
          req,
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

    req.body = {
      // todo avoid body in next versions
      ...(req.body || {}),
      ...normalizedFields,
      ...files,
    };
    return next();
  }
}

export default RequestParser;
