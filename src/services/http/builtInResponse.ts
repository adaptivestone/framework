import type { HttpResponse } from './responses.ts';

const PRODUCED = Symbol('builtInResponse');

type Marked = { [PRODUCED]?: HttpResponse };

/**
 * Return `response` from a framework controller handler, remembering it on the
 * request. An app override that calls the handler as `await super.x(req, res)`
 * without returning its result would otherwise answer nothing; the adapter
 * sends the remembered response instead (and warns once). 5.x bridge: in v6
 * the result must be returned.
 */
export function builtInResponse<T extends HttpResponse>(
  req: object,
  response: T,
): T {
  (req as Marked)[PRODUCED] = response;
  return response;
}

/** The response a framework handler produced for `req`, if any. */
export function producedBuiltInResponse(req: object): HttpResponse | undefined {
  return (req as Marked)[PRODUCED];
}
