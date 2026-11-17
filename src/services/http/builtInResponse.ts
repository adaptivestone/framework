// Transitional (5.x only): this module is removed in v6, where a handler's
// response is sent only if it is returned.
import type { HttpResponse } from './responses.ts';

type Send = (response: HttpResponse) => void;
type Claim = { send?: Send };
type LegacyResponse = { statusCode: number; headersSent: boolean };

const responses = new WeakMap<object, { response: HttpResponse } | Claim>();

/**
 * Return `response` from a framework controller handler, remembering it in
 * case an app override drops it (calls `super.x(req, res)` without returning
 * the result); the adapter then sends it and warns once. It is kept under
 * both `req` and `res`, so it is found if either is the request's own (the
 * override may pass a copy of `req` or a wrapper of `res`). The status is also
 * shown on `res` and the request's own `res`, where such an override reads it.
 * Transitional: removed in v6.
 */
export function builtInResponse<T extends HttpResponse>(
  req: object,
  response: T,
  res?: LegacyResponse,
): T {
  const keys = res ? [res, req] : [req];
  const claim = keys
    .map((key) => responses.get(key))
    .find((record): record is Claim => !!record && !('response' in record));
  if (claim) {
    claim.send?.(response);
  } else {
    for (const key of keys) {
      responses.set(key, { response });
    }
  }

  // An override may read the status after awaiting the built-in handler.
  for (const transport of [res, (req as { res?: LegacyResponse }).res]) {
    if (transport && !transport.headersSent) {
      transport.statusCode = response.status;
    }
  }
  return response;
}

/**
 * Pass `send` the response a framework handler produced and the override
 * dropped: at once if there is one, else when it arrives. Both `req` and `res`
 * are claimed, so a handler called without `res` is found too; the response is
 * delivered once. Transitional: removed in v6.
 */
export function claimBuiltInResponse(
  req: object,
  res: object,
  send: Send,
): void {
  const record = responses.get(res) ?? responses.get(req);
  if (record && !('response' in record)) {
    return;
  }

  const claim: Claim = {};
  responses.set(req, claim);
  responses.set(res, claim);
  if (record) {
    send(record.response);
  } else {
    claim.send = (response) => {
      delete claim.send;
      // Give the override's continuations a chance to answer first.
      setImmediate(send, response);
    };
  }
}
