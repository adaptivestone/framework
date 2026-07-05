# Error-Handler Registry (P1p) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed throwable HTTP errors (`HttpError` + subclasses) and an extensible error-class → response registry on `HttpServer`, with the P1o mongoose safety net folded in as a built-in entry.

**Architecture:** New public vocabulary module `httpErrors.ts`; registry types + built-in entries in `builtinErrorHandlers.ts`; two-tier storage and `registerErrorHandler`/`resolveError` on `HttpServer`; the wrapped-handler catch in `controllers/index.ts` shrinks to headersSent guard → `resolveError` walk → unchanged 500 fallback. Spec: `.plans/refactor/queued/error-handler-registry.md`.

**Tech Stack:** TypeScript ESM, vitest 4 (no `basic` reporter), mongoose, winston, biome.

## Global Constraints

- **NEVER COMMIT — leave ALL changes uncommitted in the working tree.** The user reviews code before any commit and commits themselves. This overrides any commit instruction in skill templates, including the per-task "Commit" steps convention. Do not run `git commit`, `git add`, or any history-mutating git command.
- Matching: consumer tier checked BEFORE built-ins; registration order within each tier; first `instanceof` match whose handler returns non-null wins; `null`/`undefined` return = try next entry.
- Built-in order: `HttpError` mapper (logLevel `verbose`), then mongoose safety net (logLevel `warn`). Consumer default logLevel `warn`, overridable via `opts.logLevel`.
- A handler that throws/rejects: log it at `error`, ABORT the walk, fall through to 500. Never crashes the wrapper, never re-enters the registry.
- `res.headersSent` guard stays FIRST in the catch; that path stays `logger?.error(err)` → `next(err)` exactly as today.
- Unmatched errors: `logger?.error(err)` → 500 `{ message: 'Platform error. Please check later or contact support' }` — byte-identical to today.
- Response send is centralized: `res.status(result.status).json(result.body)`; handlers never see `res`.
- P1o semantics UNCHANGED: the existing 8 safety-net tests in `src/controllers/index.test.ts` (describe `ControllerManager — Mongoose validation safety net`) must pass without edits to their assertions.
- `HttpError` response body: `body ?? { message }`.
- `registerErrorHandler` returns an unregister function.
- Out of scope: CastError handling, path→name mapping config, i18n of messages, per-controller scoping, removing/reordering built-ins via API.
- Quality gates when a task says "full gates": `npx vitest run` (full suite; only `redisConnection` failures from a missing local Redis are ignorable, and only if they fail identically before your change), `npm run check:types`, `npm run check` (biome).
- Baseline at plan time: branch `main` @ `53b6e80`, working tree has UNRELATED uncommitted changes under `.plans/` (spec + this plan) — leave them alone.

## File Structure

- Create: `src/services/http/httpErrors.ts` — public throw vocabulary (HttpError + 5 subclasses). One responsibility: error classes, zero framework imports.
- Create: `src/services/http/httpErrors.test.ts` — pure unit tests, no server.
- Create: `src/services/http/builtinErrorHandlers.ts` — registry types (`ErrorHandlerResult`, `ErrorHandlerFn`, `RegisteredErrorHandler`, `ErrorLogLevel`), `matchedClientValidationErrors` (MOVED verbatim from `controllers/index.ts`), `builtInErrorHandlers()` factory.
- Modify: `src/services/http/HttpServer.ts` — `#errorHandlers`/`#builtInHandlers` storage, `registerErrorHandler()`, `resolveError()`.
- Modify: `src/controllers/index.ts` — catch block refactor (Task 3); helper deletion (Task 2).
- Create: `src/tests/fixtures/controllers/ErrorRegistryController.ts` — fixture routes throwing each error shape.
- Modify: `src/controllers/index.test.ts` — hoist `CaptureTransport` to module scope; add registry describes (unit-level in Task 2, HTTP-level in Task 3).
- Modify: `CHANGELOG.md` (`[Unreleased]`), `scripts/packaging-smoke-test.sh` (one import line).

---

### Task 1: HttpError vocabulary

**Files:**
- Create: `src/services/http/httpErrors.ts`
- Test: `src/services/http/httpErrors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class HttpError extends Error { constructor(status: number, message: string, body?: unknown); readonly status: number; readonly body?: unknown }`; subclasses `BadRequestError`(400, default msg `'Bad request'`), `UnauthorizedError`(401, `'Unauthorized'`), `ForbiddenError`(403, `'Forbidden'`), `NotFoundError`(404, `'Not found'`), `ConflictError`(409, `'Conflict'`), each `constructor(message?: string, body?: unknown)`. Tasks 2–3 rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/services/http/httpErrors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UnauthorizedError,
} from './httpErrors.ts';

describe('httpErrors', () => {
  it('base HttpError carries status, message and optional body', () => {
    const err = new HttpError(422, 'Unprocessable', { errors: { csv: 'bad' } });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(422);
    expect(err.message).toBe('Unprocessable');
    expect(err.body).toEqual({ errors: { csv: 'bad' } });
    expect(err.name).toBe('HttpError');
  });

  it.each([
    [BadRequestError, 400, 'Bad request'],
    [UnauthorizedError, 401, 'Unauthorized'],
    [ForbiddenError, 403, 'Forbidden'],
    [NotFoundError, 404, 'Not found'],
    [ConflictError, 409, 'Conflict'],
  ] as const)('subclass fixes status %#', (Cls, status, defaultMessage) => {
    const err = new Cls();
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(defaultMessage);
    expect(err.body).toBeUndefined();
    expect(err.name).toBe(Cls.name);
  });

  it('subclasses accept a custom message and body', () => {
    const err = new NotFoundError('Boat not found', { code: 'BOAT_MISSING' });
    expect(err.status).toBe(404);
    expect(err.message).toBe('Boat not found');
    expect(err.body).toEqual({ code: 'BOAT_MISSING' });
  });

  it('a consumer subclass keeps the instanceof chain and its own name', () => {
    class PaymentRequiredError extends HttpError {
      constructor(message = 'Subscription expired') {
        super(402, message);
      }
    }
    const err = new PaymentRequiredError();
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(402);
    expect(err.name).toBe('PaymentRequiredError');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/http/httpErrors.test.ts`
Expected: FAIL — cannot resolve `./httpErrors.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/services/http/httpErrors.ts`:

```ts
/**
 * Throwable HTTP errors — the deliberate way to produce a status from deep
 * business logic without threading `res`. Thrown under a route handler, they
 * resolve through the error-handler registry
 * (`HttpServer.registerErrorHandler`) via a built-in mapper:
 * `status` + `body ?? { message }`, logged at `verbose` (control flow, not a
 * defect). Subclass for other statuses, or construct the base directly:
 * `new HttpError(422, 'Unprocessable')`.
 */
export class HttpError extends Error {
  readonly status: number;

  /** Optional response-body override; the mapper falls back to `{ message }`. */
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', body?: unknown) {
    super(400, message, body);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized', body?: unknown) {
    super(401, message, body);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', body?: unknown) {
    super(403, message, body);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found', body?: unknown) {
    super(404, message, body);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict', body?: unknown) {
    super(409, message, body);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/http/httpErrors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify types/lint — do NOT commit**

Run: `npm run check:types:raw` and `npm run check` — both clean. Leave everything uncommitted (Global Constraints).

---

### Task 2: Registry on HttpServer + built-in entries

**Files:**
- Create: `src/services/http/builtinErrorHandlers.ts`
- Modify: `src/services/http/HttpServer.ts` (fields after `routeRegistry: RouteRegistry;` ~line 45; methods after `mountAdapter()` ~line 127)
- Modify: `src/controllers/index.ts` — DELETE the file-local `matchedClientValidationErrors` (lines ~537–573, incl. its JSDoc) and import it from the new module instead (the catch block itself is untouched until Task 3)
- Test: `src/controllers/index.test.ts` (new describe; uses the booted `appInstance`)

**Interfaces:**
- Consumes: `HttpError` from Task 1; existing `FrameworkRequest` (type) from `HttpServer.ts`; existing `matchedClientValidationErrors` body moved verbatim.
- Produces (Task 3 relies on these exactly):
  - `HttpServer.registerErrorHandler<E extends Error>(errorClass: abstract new (...args: never[]) => E, handler: ErrorHandlerFn<E>, opts?: { logLevel?: ErrorLogLevel }): () => void`
  - `HttpServer.resolveError(err: unknown, req: FrameworkRequest): Promise<(ErrorHandlerResult & { logLevel: ErrorLogLevel }) | null>`
  - from `builtinErrorHandlers.ts`: `ErrorHandlerResult { status: number; body: unknown }`, `ErrorHandlerFn<E extends Error = Error>`, `RegisteredErrorHandler`, `ErrorLogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly'`, `matchedClientValidationErrors`, `builtInErrorHandlers(): RegisteredErrorHandler[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/controllers/index.test.ts` (after the P1o safety-net describe). Add `ErrorHandlerResult` type import if needed by your assertions; `appInstance` and `mongoose` imports: `appInstance` is already imported at the top; add `import mongoose from 'mongoose';` and `import { HttpError, NotFoundError } from '../services/http/httpErrors.ts';` and `import type { FrameworkRequest } from '../services/http/HttpServer.ts';` to the top import block.

```ts
// ─── Error-handler registry (P1p) — resolveError unit level ─────────

describe('HttpServer.resolveError — registry resolution', () => {
  const httpServer = () => {
    if (!appInstance.httpServer) throw new Error('test server not booted');
    return appInstance.httpServer;
  };
  const fakeReq = (request: Record<string, unknown> = {}) =>
    ({ appInfo: { request, query: {} } }) as unknown as FrameworkRequest;

  const unregisters: Array<() => void> = [];
  afterEach(() => {
    for (const u of unregisters.splice(0)) u();
  });

  it('built-in HttpError mapper: status + { message } default body, verbose level', async () => {
    const resolved = await httpServer().resolveError(
      new NotFoundError('Boat not found'),
      fakeReq(),
    );
    expect(resolved).toEqual({
      status: 404,
      body: { message: 'Boat not found' },
      logLevel: 'verbose',
    });
  });

  it('built-in HttpError mapper: explicit body wins over { message }', async () => {
    const resolved = await httpServer().resolveError(
      new HttpError(422, 'Unprocessable', { errors: { csv: 'bad' } }),
      fakeReq(),
    );
    expect(resolved).toEqual({
      status: 422,
      body: { errors: { csv: 'bad' } },
      logLevel: 'verbose',
    });
  });

  it('built-in mongoose entry delegates to the safety-net matching (warn level)', async () => {
    const vErr = new mongoose.Error.ValidationError();
    vErr.addError(
      'name',
      new mongoose.Error.ValidatorError({ message: 'too long', path: 'name' }),
    );
    const matched = await httpServer().resolveError(vErr, fakeReq({ name: 'x' }));
    expect(matched).toEqual({
      status: 400,
      body: { errors: { name: 'too long' } },
      logLevel: 'warn',
    });
    // Same error, no matching client key → null (caller keeps the 500).
    expect(await httpServer().resolveError(vErr, fakeReq())).toBeNull();
  });

  it('unmatched error class → null', async () => {
    expect(await httpServer().resolveError(new Error('x'), fakeReq())).toBeNull();
  });

  it('consumer handler wins over built-ins and unregister restores them', async () => {
    const unregister = httpServer().registerErrorHandler(HttpError, () => ({
      status: 418,
      body: { message: 'teapot' },
    }));
    unregisters.push(unregister);
    const overridden = await httpServer().resolveError(new NotFoundError('x'), fakeReq());
    expect(overridden?.status).toBe(418);
    expect(overridden?.logLevel).toBe('warn'); // consumer default
    unregister();
    const restored = await httpServer().resolveError(new NotFoundError('x'), fakeReq());
    expect(restored?.status).toBe(404);
  });

  it('null return falls through to the next entry (consumer → built-in)', async () => {
    unregisters.push(
      httpServer().registerErrorHandler(HttpError, () => null),
    );
    const resolved = await httpServer().resolveError(new NotFoundError('x'), fakeReq());
    expect(resolved?.status).toBe(404); // built-in still reached
  });

  it('consumer tier respects registration order', async () => {
    class OrderedError extends Error {}
    unregisters.push(
      httpServer().registerErrorHandler(OrderedError, () => null),
      httpServer().registerErrorHandler(OrderedError, () => ({
        status: 410,
        body: { message: 'second' },
      })),
    );
    const resolved = await httpServer().resolveError(new OrderedError(), fakeReq());
    expect(resolved).toEqual({ status: 410, body: { message: 'second' }, logLevel: 'warn' });
  });

  it('async handler result is awaited; opts.logLevel overrides the default', async () => {
    class AsyncMapped extends Error {}
    unregisters.push(
      httpServer().registerErrorHandler(
        AsyncMapped,
        async () => ({ status: 402, body: { message: 'later' } }),
        { logLevel: 'info' },
      ),
    );
    const resolved = await httpServer().resolveError(new AsyncMapped(), fakeReq());
    expect(resolved).toEqual({ status: 402, body: { message: 'later' }, logLevel: 'info' });
  });

  it('a throwing handler aborts the walk → null (500 at the caller)', async () => {
    class Crashy extends Error {}
    unregisters.push(
      httpServer().registerErrorHandler(Crashy, () => {
        throw new Error('handler exploded');
      }),
      // Would match if the walk continued — it must not.
      httpServer().registerErrorHandler(Crashy, () => ({
        status: 400,
        body: { message: 'unreachable' },
      })),
    );
    expect(await httpServer().resolveError(new Crashy(), fakeReq())).toBeNull();
  });
});
```

Note: `afterEach` must be added to the vitest import at the top of the file if not already there (current import has `afterAll, beforeAll, beforeEach` — extend it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/controllers/index.test.ts`
Expected: the new describe FAILS with `resolveError is not a function`; the pre-existing tests (incl. all 8 P1o ones) still PASS.

- [ ] **Step 3: Create `src/services/http/builtinErrorHandlers.ts`**

```ts
import mongoose from 'mongoose';
import type { FrameworkRequest } from './HttpServer.ts';
import { HttpError } from './httpErrors.ts';

/** Levels the registry may log a handled error at (winston leveled methods). */
export type ErrorLogLevel =
  | 'error'
  | 'warn'
  | 'info'
  | 'http'
  | 'verbose'
  | 'debug'
  | 'silly';

/** What a handler returns to produce a response; `null`/`undefined` = pass. */
export interface ErrorHandlerResult {
  status: number;
  body: unknown;
}

export type ErrorHandlerFn<E extends Error = Error> = (
  err: E,
  req: FrameworkRequest,
) =>
  | ErrorHandlerResult
  | null
  | undefined
  | Promise<ErrorHandlerResult | null | undefined>;

/** A registered (class, handler, level) triple as stored by the registry. */
export interface RegisteredErrorHandler {
  errorClass: abstract new (...args: never[]) => Error;
  handler: ErrorHandlerFn;
  logLevel: ErrorLogLevel;
}

/**
 * Safety net for an escaped Mongoose `ValidationError`: returns a per-field
 * `{ <path>: message }` map ONLY when every failing model path is a field the
 * client actually sent — the keys of the validated `request` ∪ `query`, minus
 * the framework-injected `contentType` discriminant (see
 * `ControllerManager.#wrapHandlerEntry`). A nested path (`profile.name`)
 * matches on its first segment and is reported under the full path (the
 * client owns that subtree). Any renamed/internal path → `null`, so the
 * caller keeps the honest 500 and never leaks a non-public field name.
 */
export function matchedClientValidationErrors(
  err: mongoose.Error.ValidationError,
  req: FrameworkRequest,
): Record<string, string> | null {
  const failingPaths = Object.keys(err.errors);
  if (failingPaths.length === 0) {
    return null;
  }
  const inputKeys = new Set<string>();
  for (const source of [req.appInfo.request, req.appInfo.query]) {
    if (source) {
      for (const key of Object.keys(source)) {
        inputKeys.add(key);
      }
    }
  }
  inputKeys.delete('contentType');

  const errors: Record<string, string> = {};
  for (const failingPath of failingPaths) {
    if (!inputKeys.has(failingPath.split('.')[0])) {
      return null;
    }
    errors[failingPath] = err.errors[failingPath].message;
  }
  return errors;
}

/**
 * Framework built-in registry entries, checked AFTER any consumer-registered
 * handlers ("yours win"):
 *   1. `HttpError` → its own status / `body ?? { message }`; `verbose`
 *      (deliberate control flow, not a defect).
 *   2. Escaped Mongoose `ValidationError` → the safety net above; `warn`
 *      (signals a route schema missing a constraint the model enforces).
 */
export function builtInErrorHandlers(): RegisteredErrorHandler[] {
  return [
    {
      errorClass: HttpError,
      // Entries are stored type-erased (`ErrorHandlerFn`); `resolveError`
      // guarantees `instanceof errorClass` before the call.
      handler: (err) => {
        const httpErr = err as HttpError;
        return {
          status: httpErr.status,
          body: httpErr.body ?? { message: httpErr.message },
        };
      },
      logLevel: 'verbose',
    },
    {
      errorClass: mongoose.Error.ValidationError,
      handler: (err, req) => {
        const clientErrors = matchedClientValidationErrors(
          err as mongoose.Error.ValidationError,
          req,
        );
        return clientErrors
          ? { status: 400, body: { errors: clientErrors } }
          : null;
      },
      logLevel: 'warn',
    },
  ];
}
```

(The `FrameworkRequest` import is type-only, so there is no runtime cycle with `HttpServer.ts` importing this module by value.)

- [ ] **Step 4: Add storage + methods to `src/services/http/HttpServer.ts`**

Add to the import block:

```ts
import {
  builtInErrorHandlers,
  type ErrorHandlerFn,
  type ErrorHandlerResult,
  type ErrorLogLevel,
  type RegisteredErrorHandler,
} from './builtinErrorHandlers.ts';
```

Add fields after `routeRegistry: RouteRegistry;`:

```ts
  /** Consumer-registered error handlers — checked before the built-ins. */
  #errorHandlers: RegisteredErrorHandler[] = [];

  #builtInHandlers: RegisteredErrorHandler[] = builtInErrorHandlers();
```

Add methods after `mountAdapter()`:

```ts
  /**
   * Register a handler mapping a thrown error class to an HTTP response.
   * Consumer handlers are checked before the built-ins (`HttpError` mapper,
   * mongoose validation safety net) in registration order — the first
   * `instanceof` match whose handler returns non-null wins; return `null` to
   * pass to the next entry. Typical registration point is the project's
   * `bootHttp` hook. Returns an unregister function.
   */
  registerErrorHandler<E extends Error>(
    errorClass: abstract new (...args: never[]) => E,
    handler: ErrorHandlerFn<E>,
    opts?: { logLevel?: ErrorLogLevel },
  ): () => void {
    const entry: RegisteredErrorHandler = {
      errorClass,
      // Stored type-erased; `resolveError` guarantees `instanceof errorClass`
      // before the call, so the narrower parameter type is safe.
      handler: handler as ErrorHandlerFn,
      logLevel: opts?.logLevel ?? 'warn',
    };
    this.#errorHandlers.push(entry);
    return () => {
      const i = this.#errorHandlers.indexOf(entry);
      if (i !== -1) {
        this.#errorHandlers.splice(i, 1);
      }
    };
  }

  /**
   * Resolve a handler-thrown error through the registry: consumer tier first,
   * then built-ins; first `instanceof` match returning non-null wins. A
   * handler that itself throws aborts the walk (logged here at `error`; the
   * caller falls through to its 500) — never a crash loop. Returns null when
   * no entry produced a response.
   */
  async resolveError(
    err: unknown,
    req: FrameworkRequest,
  ): Promise<(ErrorHandlerResult & { logLevel: ErrorLogLevel }) | null> {
    for (const entry of [...this.#errorHandlers, ...this.#builtInHandlers]) {
      if (err instanceof entry.errorClass) {
        let result: ErrorHandlerResult | null | undefined;
        try {
          result = await entry.handler(err, req);
        } catch (handlerErr) {
          this.logger?.error(
            `Error handler for ${entry.errorClass.name} threw: ${handlerErr}`,
          );
          return null;
        }
        if (result != null) {
          return { ...result, logLevel: entry.logLevel };
        }
      }
    }
    return null;
  }
```

- [ ] **Step 5: Point `controllers/index.ts` at the moved helper**

In `src/controllers/index.ts`: delete the entire file-local `matchedClientValidationErrors` function AND its JSDoc block (currently lines ~537–573, under `// ─── translation helpers (file-local) ───`), and add to the import block:

```ts
import { matchedClientValidationErrors } from '../services/http/builtinErrorHandlers.ts';
```

The catch block still calls it directly — behavior identical; Task 3 replaces that call with the registry walk.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/controllers/index.test.ts src/services/http/httpErrors.test.ts`
Expected: PASS — all new registry tests AND the untouched 8 P1o tests.

- [ ] **Step 7: Verify types/lint — do NOT commit**

Run: `npm run check:types` and `npm run check` — clean. Leave everything uncommitted.

---

### Task 3: Catch-block refactor + HTTP integration tests + changelog

**Files:**
- Modify: `src/controllers/index.ts` (the second try/catch in `#wrapHandlerEntry`, currently lines ~457–485)
- Create: `src/tests/fixtures/controllers/ErrorRegistryController.ts`
- Test: `src/controllers/index.test.ts` (new HTTP-level describe; hoist `CaptureTransport`)
- Modify: `CHANGELOG.md`, `scripts/packaging-smoke-test.sh`

**Interfaces:**
- Consumes: `resolveError`/`registerErrorHandler` exactly as produced by Task 2; `HttpError`/`NotFoundError` from Task 1; existing test harness (`appInstance`, `getTestServerURL`, `registerController(Class, 'test')`, CaptureTransport pattern).
- Produces: final behavior; no later task.

- [ ] **Step 1: Create the fixture controller**

Create `src/tests/fixtures/controllers/ErrorRegistryController.ts`:

```ts
import type { Response } from 'express';
import type {
  RouteParams,
  TMiddleware,
} from '../../../modules/AbstractController.ts';
import AbstractController from '../../../modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../services/http/HttpServer.ts';
import {
  HttpError,
  NotFoundError,
} from '../../../services/http/httpErrors.ts';

/** An "unowned" third-party-style error; the test registers a handler for it. */
export class FakeDriverError extends Error {
  code: number;

  constructor(code: number) {
    super(`driver failed with code ${code}`);
    this.name = 'FakeDriverError';
    this.code = code;
  }
}

/** Registered with a handler that itself throws — the crash-safety case. */
export class HandlerCrashError extends Error {}

class ErrorRegistryController extends AbstractController {
  get routes(): RouteParams {
    return {
      get: {
        '/notFound': { handler: this.throwNotFound },
        '/customBase': { handler: this.throwCustomBase },
        '/unowned': { handler: this.throwUnowned },
        '/unownedPass': { handler: this.throwUnownedPass },
        '/handlerCrash': { handler: this.throwHandlerCrash },
        '/plain': { handler: this.throwPlain },
      },
    };
  }

  async throwNotFound(_req: FrameworkRequest, _res: Response) {
    throw new NotFoundError('Boat not found');
  }

  async throwCustomBase(_req: FrameworkRequest, _res: Response) {
    throw new HttpError(422, 'Unprocessable', {
      errors: { csv: 'row 17 malformed' },
    });
  }

  async throwUnowned(_req: FrameworkRequest, _res: Response) {
    throw new FakeDriverError(11000);
  }

  async throwUnownedPass(_req: FrameworkRequest, _res: Response) {
    // The registered handler returns null for this code → falls through to 500.
    throw new FakeDriverError(42);
  }

  async throwHandlerCrash(_req: FrameworkRequest, _res: Response) {
    throw new HandlerCrashError('boom');
  }

  async throwPlain(_req: FrameworkRequest, _res: Response) {
    throw new Error('unmapped plain error');
  }

  // Error-path fixture — no auth (the inherited default [GetUserByToken, Auth]
  // would 401 every request).
  static get middleware(): Map<string, TMiddleware> {
    return new Map();
  }
}

export default ErrorRegistryController;
```

- [ ] **Step 2: Write the failing HTTP tests**

In `src/controllers/index.test.ts`:

(a) Hoist the `LogRecord` interface and `CaptureTransport` class from inside the P1o describe (lines ~505–515) to module scope, right after the `// ─── fixtures ───` block — a pure move, no changes to the class body or to any P1o test assertions. The P1o describe keeps using them.

(b) Add imports: `import ErrorRegistryController, { FakeDriverError, HandlerCrashError } from '../tests/fixtures/controllers/ErrorRegistryController.ts';`

(c) Append the describe:

```ts
// ─── Error-handler registry (P1p) — over HTTP ────────────────────────

describe('Error-handler registry over HTTP', () => {
  const base = '/test/errorregistrycontroller';
  const get = (path: string) => fetch(getTestServerURL(`${base}${path}`));

  let capture: CaptureTransport;
  let silenced: Transport[] = [];
  const unregisters: Array<() => void> = [];
  const logsMatching = (re: RegExp) =>
    capture.records.filter((r) => re.test(r.message));

  beforeAll(() => {
    appInstance.controllerManager?.registerController(
      ErrorRegistryController,
      'test',
    );
    if (!appInstance.httpServer) throw new Error('test server not booted');
    unregisters.push(
      appInstance.httpServer.registerErrorHandler(FakeDriverError, (err) =>
        err.code === 11000
          ? { status: 409, body: { message: 'Already exists' } }
          : null,
      ),
      appInstance.httpServer.registerErrorHandler(HandlerCrashError, () => {
        throw new Error('handler exploded');
      }),
    );
    capture = new CaptureTransport();
    appInstance.logger.add(capture);
    silenced = appInstance.logger.transports.filter((t) => t !== capture);
    for (const t of silenced) {
      t.silent = true;
    }
  });

  afterAll(() => {
    for (const u of unregisters.splice(0)) u();
    for (const t of silenced) {
      t.silent = false;
    }
    appInstance.logger.remove(capture);
  });

  beforeEach(() => {
    capture.records.length = 0;
  });

  it('thrown NotFoundError → 404 { message }, verbose log', async () => {
    const res = await get('/notFound');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Boat not found' });
    expect(logsMatching(/Boat not found/).map((r) => r.level)).toEqual([
      'verbose',
    ]);
  });

  it('HttpError base with custom body → status + body override', async () => {
    const res = await get('/customBase');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors: { csv: 'row 17 malformed' } });
  });

  it('registered unowned error, matching branch → mapped 409, warn log', async () => {
    const res = await get('/unowned');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: 'Already exists' });
    expect(
      logsMatching(/driver failed with code 11000/).map((r) => r.level),
    ).toEqual(['warn']);
  });

  it('registered handler returns null → falls through to 500, error log', async () => {
    const res = await get('/unownedPass');
    expect(res.status).toBe(500);
    expect(
      logsMatching(/driver failed with code 42/).map((r) => r.level),
    ).toEqual(['error']);
  });

  it('a throwing consumer handler → 500, both errors logged at error', async () => {
    const res = await get('/handlerCrash');
    expect(res.status).toBe(500);
    expect(logsMatching(/handler exploded|HandlerCrashError/).length)
      .toBeGreaterThanOrEqual(1);
    expect(logsMatching(/boom/).map((r) => r.level)).toEqual(['error']);
  });

  it('plain Error stays a 500 with error log (unchanged fallback)', async () => {
    const res = await get('/plain');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      message: 'Platform error. Please check later or contact support',
    });
    expect(logsMatching(/unmapped plain error/).map((r) => r.level)).toEqual([
      'error',
    ]);
  });

  it('consumer override of a built-in wins end-to-end', async () => {
    const unregister = appInstance.httpServer?.registerErrorHandler(
      NotFoundError,
      () => ({ status: 418, body: { message: 'teapot' } }),
    );
    try {
      const res = await get('/notFound');
      expect(res.status).toBe(418);
      expect(await res.json()).toEqual({ message: 'teapot' });
    } finally {
      unregister?.();
    }
    const restored = await get('/notFound');
    expect(restored.status).toBe(404);
  });
});
```

Also extend the top-of-file imports with `NotFoundError` (from `../services/http/httpErrors.ts` — already imported for the Task 2 describe; reuse it).

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run src/controllers/index.test.ts`
Expected: the new HTTP describe FAILS (every route currently → 500 except `/plain`; e.g. `/notFound` expected 404, got 500). The Task 2 unit describe and all P1o tests still PASS.

- [ ] **Step 4: Refactor the catch block**

In `src/controllers/index.ts`, replace the second try/catch body (currently lines ~457–485, from `} catch (err) {` through the closing `}` before `};`) with:

```ts
      try {
        return await Promise.resolve(original(req, res, next));
      } catch (err) {
        // A handler that already streamed can't be sent anything — hand off to
        // the error finalizer instead of crashing with ERR_HTTP_HEADERS_SENT.
        if (res.headersSent) {
          logger?.error(err);
          return next(err);
        }
        // Error-handler registry: consumer-registered handlers first, then the
        // built-ins (`HttpError` mapper, mongoose validation safety net) —
        // first `instanceof` match returning non-null wins. Each entry carries
        // its own log level: `verbose` for deliberate HttpError control flow,
        // `warn` for the safety net's schema-gap signal, `warn` default for
        // consumer entries.
        const resolved = app.httpServer
          ? await app.httpServer.resolveError(err, req)
          : null;
        if (resolved) {
          logger?.[resolved.logLevel](err);
          return res.status(resolved.status).json(resolved.body);
        }
        logger?.error(err);
        return res.status(500).json({
          message: 'Platform error. Please check later or contact support',
        });
      }
```

Then remove the now-unused imports from `src/controllers/index.ts`: `matchedClientValidationErrors` (added in Task 2) and — if nothing else in the file uses it — `mongoose`. Verify with `npm run check` (biome flags unused imports).

Note the one deliberate micro-change vs today: in the `headersSent` case the `logger?.error(err)` now runs before `next(err)` inside the guard (previously the error log line sat between the mongoose branch and the guard) — same observable behavior (exactly one error log + `next(err)`), which the existing P1o `/afterSend` test pins.

- [ ] **Step 5: Run tests to verify everything passes**

Run: `npx vitest run src/controllers/index.test.ts src/services/http/httpErrors.test.ts`
Expected: PASS — new HTTP describe, Task 2 unit describe, and all pre-existing tests including the 8 P1o ones, unmodified.

- [ ] **Step 6: CHANGELOG + packaging smoke**

In `CHANGELOG.md`, add under `## [Unreleased]` in the `### Added` section (create the section if absent, matching the file's existing style — read the current Unreleased block first):

```md
- **Error-handler registry + typed HTTP errors.** Throw `NotFoundError` / `new HttpError(status, message, body?)` (from `services/http/httpErrors.js`) inside a route handler to produce that status (built-in mapper, logged `verbose`), or map error classes you don't own via `app.httpServer.registerErrorHandler(ErrorClass, handler, { logLevel? })` (returns an unregister function) — e.g. from the `bootHttp` hook. Consumer handlers are checked before built-ins; a handler returning `null` passes to the next entry; unmatched errors keep the 500. The Mongoose validation safety net is now a built-in registry entry (semantics unchanged).
```

In `scripts/packaging-smoke-test.sh`, add one line to the import list (after the `GetUserByToken.js` entry):

```js
  '@adaptivestone/framework/services/http/httpErrors.js',
```

- [ ] **Step 7: Full gates — do NOT commit**

Run: `npx vitest run` (full suite), `npm run check:types`, `npm run check`.
Expected: all green (`redisConnection` ECONNREFUSED failures ignorable only if present without your change); gen output unchanged (`npm run check:types` runs `gen` first — `git status` must show no new/modified gen artifacts, they are gitignored anyway).
Leave EVERYTHING uncommitted — the user reviews the working tree.

---

## Self-Review (done at plan time)

- Spec coverage: throw vocabulary (T1), registry + tiers + unregister + logLevels + built-ins incl. safety-net relocation (T2), catch refactor + headersSent + 500 fallback + HTTP matrix + changelog + smoke (T3). Docs-repo chapter is a spec follow-up outside this repo — not in this plan.
- P1o regression: pinned by leaving all 8 safety-net tests untouched (T2 Step 6, T3 Step 5).
- Type consistency: `ErrorHandlerFn`/`ErrorHandlerResult`/`ErrorLogLevel`/`RegisteredErrorHandler` defined once in `builtinErrorHandlers.ts`; `registerErrorHandler`/`resolveError` signatures identical in T2 interfaces, T2 Step 4 code, and T3 usage.
