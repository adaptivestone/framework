// Transitional (5.x only): this module is removed in v6, where a handler's
// response is sent only if it is returned.
import type { HttpResponse } from './responses.ts';

const PRODUCED = Symbol('builtInResponse');
const CLAIM = Symbol('builtInResponseClaim');

type Send = (response: HttpResponse) => void;

type Marked = { [PRODUCED]?: HttpResponse; [CLAIM]?: Send };

/**
 * Return `response` from a framework controller handler, remembering it on the
 * request. An app override that calls the handler (`super.x(req, res)`)
 * without returning its result would otherwise answer nothing; the adapter
 * sends the remembered response instead (and warns once). Transitional:
 * removed in v6.
 */
export function builtInResponse<T extends HttpResponse>(
  req: object,
  response: T,
): T {
  const marked = req as Marked;
  marked[PRODUCED] = response;
  marked[CLAIM]?.(response);
  return response;
}

/**
 * Pass `send` the response a framework handler produced for `req`: at once if
 * there is one, else when it arrives (the override did not await the handler).
 * Transitional: removed in v6.
 */
export function claimBuiltInResponse(req: object, send: Send): void {
  const marked = req as Marked;
  if (marked[PRODUCED]) {
    send(marked[PRODUCED]);
  } else {
    marked[CLAIM] = send;
  }
}
