import { unlink } from 'node:fs/promises';
import type { NextFunction, Response } from 'express';
import formidable from 'formidable';
import type ThttpConfig from '../../../config/http.ts';
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
    const form = formidable({ ...requestParser, ...this.params }); // not in construstor as reuse formidable affects performance

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
    } catch (err) {
      this.logger?.error(`Parsing failed ${err}`);
      // formidable tags limit-exceeded errors (file/field size, file/field
      // count) with httpCode 413; everything else (bad content type / length)
      // stays a 400.
      if ((err as { httpCode?: number })?.httpCode === 413) {
        return res.status(413).json({
          message:
            'Request entity too large. Your upload exceeds the allowed size or count limits.',
        });
      }
      return res.status(400).json({
        message: `Error to parse your request. You provided invalid content type or content-length. Please check your request headers and content type.`,
      });
      // return next(err);
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
