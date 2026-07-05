# P1p — Extensible handler-error registry (typed HTTP errors + error-class → response mapping)

**Status**: ✅ implemented 2026-07-05 — code in working tree, awaiting user review + commit (v5.1 additive; P1o's behavior-change entry stays separate).
**Depends on**: P1o ✅ (mongoose safety net — becomes a built-in registry entry), bootHttp hook ✅ (the consumer registration point)
**Origin**: 2026-07-05. The wrapped-handler catch (`src/controllers/index.ts`) turns every thrown error into a blanket 500 except the P1o mongoose branch. Consumers have no way to (a) deliberately produce an HTTP status from deep business logic without threading `res`, or (b) map third-party error types they don't own (Mongo driver, SDKs) to proper responses. User wants both, with the mongoose safety net folded into the same extensible mechanism rather than staying hardcoded.

## Goal

Any error thrown under a route handler resolves through one ordered registry: consumer-registered handlers first, then framework built-ins (`HttpError` mapper, P1o mongoose safety net), then the unchanged 500 fallback. Consumers extend via a typed boot API.

## Design

### Throwable HTTP errors (own-code path)

New `src/services/http/httpErrors.ts`:

- `HttpError` base: `constructor(status: number, message: string, body?: unknown)`. Response is `status` + `body ?? { message }`.
- Subclasses fixing the status: `BadRequestError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409). Each `constructor(message, body?)`.
- Consumers subclass `HttpError` for other statuses, or construct the base directly (`new HttpError(422, '…')`).
- Exported via the existing `services/*` exports-map surface.

### Registry (unowned-errors path)

`app.httpServer.registerErrorHandler(ErrorClass, handler, opts?)` on `HttpServer`:

- Signature (indicative): `<C extends new (...args: never[]) => Error>(errorClass: C, handler: (err: InstanceType<C>, req) => MaybePromise<{ status: number; body: unknown } | null | undefined>, opts?: { logLevel?: string })` — `err` auto-typed from the registered class. Exact constructor-type constraint is the implementer's call, but it must also accept abstract base classes (`abstract new`-compatible).
- Called from the project's `bootHttp` hook (or anywhere before/while serving; registration is just an array push). Returns an **unregister function** (test isolation, feature flags).
- Returning `null`/`undefined` = "not mine after all" → matching continues to the next entry.
- Async handlers awaited. A handler that throws/rejects → `logger.error` + 500 fallback (never crashes the wrapper, never re-enters the registry).

### Matching order

1. Consumer tier (registration order) — checked FIRST, so consumers can intercept/override built-ins.
2. Built-in tier: `HttpError` mapper, then mongoose safety net.
3. First `instanceof` match whose handler returns non-null produces the response (`res.status(result.status).json(result.body)`).
4. No match / all null → today's `logger.error` + 500, byte-identical behavior.

`res.headersSent` guard stays FIRST, before the registry — a streamed-then-thrown response still goes `logger.error` → `next(err)`, unchanged.

### Built-ins become registry entries

- `HttpError` entry: maps to `{ status: err.status, body: err.body ?? { message: err.message } }`.
- Mongoose entry: the P1o `matchedClientValidationErrors` logic moves behind the registry interface — matching rule, strict all-match, 400 shape, and 500 fall-through (return null) all UNCHANGED; P1o's tests must pass untouched (except any import-path adjustments).

### Logging

- `HttpError` built-in → `verbose` (deliberate control flow, not a defect).
- Mongoose built-in → `warn` (P1o semantics: signals a route-schema gap).
- Consumer registrations → default `warn`, override via `opts.logLevel`.
- Unmatched / handler-threw → `error` (as today).

## Files touched

- `src/services/http/httpErrors.ts` — NEW: HttpError + 5 subclasses.
- `src/services/http/HttpServer.ts` — registry storage (two tiers), `registerErrorHandler`, built-in registration at construction.
- `src/controllers/index.ts` — catch block: headersSent guard → registry walk → 500 fallback; `matchedClientValidationErrors` relocates into the mongoose built-in (kept file-local or moved next to the registry — implementer's call, whichever reads cleaner).
- Tests:
  - `httpErrors`: subclass statuses, custom body, base with custom status;
  - registry via HTTP harness: thrown `NotFoundError` → 404 `{message}`; registered custom class → mapped status/body; `null` return falls through (to built-ins AND to 500); consumer handler registered for `mongoose.Error.ValidationError` overrides the built-in; unmatched error → 500; throwing/rejecting handler → 500 + error log; async handler works; log levels asserted via the existing CaptureTransport pattern in `src/controllers/index.test.ts`;
  - P1o's 8 safety-net tests stay green (semantics unmoved).
- `CHANGELOG.md` — `[NEW]` under Unreleased (additive; P1o's behavior-change bullet remains separate).
- Docs repo (follow-up at implementation): error-handling chapter — throw vocabulary, registry, ordering, logging levels.

## API change

```ts
// Own code — no res threading:
import { NotFoundError } from '@adaptivestone/framework/services/http/httpErrors.js';
throw new NotFoundError('Boat not found');        // → 404 { message: 'Boat not found' }

// Unowned errors — project bootHttp hook (Server option, receives live app):
new Server({ ...folderConfig, bootHttp: async (app) => {
  app.httpServer.registerErrorHandler(MongoServerError, (err) =>
    err.code === 11000 ? { status: 409, body: { message: 'Already exists' } } : null, // null = falls through
  );
}});

// Custom status — subclass once (or one-off `new HttpError(422, msg, body?)`):
export class PaymentRequiredError extends HttpError {
  constructor(message = 'Subscription expired') { super(402, message); }
}

// Overriding a built-in (consumer tier is checked first):
app.httpServer.registerErrorHandler(mongoose.Error.ValidationError, () =>
  ({ status: 400, body: { message: 'Invalid data' } }),
);
```

## Open questions (resolved)

- Method name: **`registerErrorHandler`** — settled by collision: `HttpServer` already has an `addErrorHandler()` (the Express 4-arg error sink, `HttpServer.ts:143`).
- `code` field on `HttpError`: NO for v1 (the `body` override covers machine-readable codes).

## Out of scope

- Per-controller handler scoping (app-global only in v1).
- i18n of error messages (thrower/handler supplies final strings).
- Errors outside the wrapped handler (middleware chain, boot, static serving) — existing paths unchanged.
- Removing/reordering built-ins via API (consumer-first ordering already lets you intercept them).

## Done when

`throw new NotFoundError(…)` in a handler → 404 with `{message}`; a bootHttp-registered handler maps a custom/third-party error to its response and can override built-ins; null-returns fall through cleanly; unmatched errors still 500 with error log; handler failures degrade to 500; P1o suite green with the safety net as a registry entry; changelog `[NEW]`. Tests green, tsc/biome clean.
