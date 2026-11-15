# P3 — `NodeAdapter` (drop Express router)

**Status**: ⏸ deferred — **owner target (2026-11-01): ships in 5.x as an opt-in adapter**, so Express
becomes optional before v6 removes it. Needs a design pass before it moves to `queued/`.
**Depends on**: P1b, [P1q universal HTTP responses](../active/universal-http-responses.md),
[P1m](../queued/async-middleware.md) (the portable pipeline it runs), the app-wide middleware API and portable built-ins
([P1m Phase 2](../queued/async-middleware.md), [v6-api-stability](../queued/v6-api-stability.md) item 1). The P2c performance gate below no
longer blocks it (owner target).
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

What was verified as _not_ a blocker:

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

Superseded 2026-11-01: the owner targets this adapter for 5.x regardless of the P2c gate.
