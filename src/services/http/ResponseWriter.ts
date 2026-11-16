import type { HttpResponse } from './responses.ts';

/**
 * Renders an `HttpResponse` to one transport. A writer owns the status line,
 * headers, serialization, stream backpressure and client-abort cleanup, and
 * decides the point after which an error can no longer replace the response:
 * `write` rejects with the error either way, and the caller can tell by
 * whether headers were sent.
 */
export interface ResponseWriter<Req, Res> {
  write(response: HttpResponse, req: Req, res: Res): Promise<void>;
}
