// Transitional (5.x only): this module is removed in v6, where a handler's
// response is sent only if it is returned.
import type { HttpResponse } from './responses.ts';

type Send = (response: HttpResponse) => void;
type Claim = { send?: Send };
type LegacyResponse = { statusCode: number; headersSent: boolean };

const responses = new WeakMap<object, { response: HttpResponse } | Claim>();

/**
 * Return and remember the descriptor in case an app override drops it.
 * The supplied Express response identifies the request even if the override
 * passed a copy of the request to the built-in handler.
 */
export function builtInResponse<T extends HttpResponse>(
  req: object,
  response: T,
  res?: LegacyResponse,
): T {
  const key = res ?? req;
  const record = responses.get(key);
  if (record && !('response' in record)) {
    record.send?.(response);
  } else {
    responses.set(key, { response });
  }

  // An override may read the status after awaiting the built-in handler.
  const transport = res ?? (req as { res?: LegacyResponse }).res;
  if (transport && !transport.headersSent) {
    transport.statusCode = response.status;
  }
  return response;
}

/**
 * Pass a dropped descriptor to the adapter, now or when the built-in handler
 * completes. Claim both keys so handlers that omit the Express response work
 * too, and either key can deliver only once.
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
