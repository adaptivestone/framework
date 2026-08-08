# P3 — `NodeAdapter` (drop Express router)

**Status**: ⏸ deferred
**Depends on**: P1b, [P1q universal HTTP responses](../queued/universal-http-responses.md), P2c
**Unblocks**: P4

## Goal (one-line)

Native `node:http` adapter — no Express. It consumes the same `HttpResponse` values already
exercised by `ExpressResponseWriter`; controllers do not change. `URLPatternAdapter` option. CI
runs both alongside `ExpressAdapter`. Streaming response helpers (`streamSSE`, `streamJSON`).
`undici` default outbound HTTP with shared Agent.

## Detail

See `_archive/REFACTOR_PLAN_v1.md` §10 + the "long-term Express drop" passages in §3.

## HTTP/2 — unlocked here, measured 2026-08-08

Serving HTTP/2 needs **no native engine and no new dependency**: stock `node:http2`. The blocker is
that Express must not be the top-level listener — `http2.createServer(expressApp)` crashes the
process on request #1 (`TypeError: Cannot read properties of undefined (reading 'readable')`).
Today `HttpServer` does `http.createServer(this.express)` and mounts global middleware with
`express.use(...)`, so the request enters Express before the adapter. That makes h2 a **P4-and-later**
capability (framework owns the listener), not merely P3 (router replaced).

What was verified as *not* a blocker:

- **Body parsing** — formidable parsed multipart over raw `node:http2`, no Express (`200 via 2`).
  Web `Request.formData()` also works, after filtering `Symbol(sensitiveHeaders)` and `:pseudo`
  headers out of `req.headers` before constructing `Headers`.
- **Response headers** — `src/` sets no h1-forbidden headers (`Connection`, `Keep-Alive`,
  `Transfer-Encoding`, `Upgrade`).

What still needs work when h2 is activated:

- **Graceful shutdown.** `HttpServer.shutdown()` calls `closeIdleConnections()`, which **does not
  exist on `Http2Server`** (`close` does; `closeIdleConnections`/`closeAllConnections` are
  `undefined`). h2 drains by tracking sessions and sending GOAWAY. Silent failure mode — it would
  surface only as pods that never terminate.
- **Test client.** `fetch()` will not negotiate h2c; tests need `node:http2.connect()` (built in,
  no new dep) alongside `getTestServerURL`. h2c needs no certificates at all; only ALPN-over-TLS
  would need a cert fixture.
- **Request type.** `FrameworkRequest extends express.Request` must become framework-owned (already
  implied by P1q + this card).

## Out of scope until activated

Skip until P2c's perf gate is met or explicitly skipped.
