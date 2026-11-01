# Settled middleware contract — Astro review

**Date:** 2026-11-01.
**Reviewed:** `ccr-80ccfb40-0qs0lo` at `dd6a39a87f1dd73546b9ad26977cf89ccb2f3800`.
**Follow-up:** [final middleware and v6 stability review](middleware-final-review-astro.md)
reviews `2b0777c` and records the remaining implementation findings.
**Responses (2026-11-01):** each finding checked and acted on —
[final recommendation §11](middleware-final-recommendation.md#11-contract-review-by-astra-2026-11-01--responses).
**Scope:** [P1m](../active/async-middleware.md),
[final recommendation](middleware-final-recommendation.md), the contract checks and their
integration with the existing runtime. Source line references below refer to this reviewed commit.

**Verdict:** the settled strict-onion direction matches the proposal. The v5 authoring and bridge
contracts need the decisions below before they are ready to implement as written. The existing
kernel checks are a useful starting point, but do not yet prove the promised guard/lifecycle
behavior. This review does not reopen onion versus H or the owner's context/state/cookie choices.

## What matches

- Returned response descriptors, a separate portable context, and `appInfo` shared with legacy code.
- Middleware/validation/handler → wrapper unwind → registry → global transform → writer/staged
  headers → exactly-once transport completion, for the descriptor path.
- Original errors available to wrappers, and no automatic retry of a request chain by a transaction
  helper.
- Lazy response bodies consumed after execution scopes unwind; resource ownership and cancellation
  must be explicit.
- Framework ALS active through execution, errors, writing and completion; completion callbacks
  restore framework context rather than implicitly retaining every middleware-owned scope.
- Omitting per-request `beforeSend` in the first version is a reasonable explicit scope decision.
- Native capabilities remain future options and do not block removing Express from the contract.

## 1. [P1] Choose and prove the actual v2 base before treating the opt-in API as ready

P1m lines 48–51 acknowledge the type conflict, while its API example at 292–301 still extends the
current `AbstractMiddleware`. A static `contractVersion = 2` does not change the instance method's
override compatibility: the base currently declares `(req, res, next): Promise<void | Response>`
in `src/services/http/middleware/AbstractMiddleware.ts:134`.

`contract-types.ts:13–19` proves forgotten-return rejection against a different, already strict base.
It does not prove the advertised v5 migration compiles against the package.

**Recommendation:** use a separately typed v2 base for the bridge, sharing implementation/metadata
where useful. Keep its public import usable in v6. A generic alternative is possible only if its
instance contract and runtime discriminator are explicitly connected; do not widen the base to
`any`/`void` and lose the strict guarantee.

This choice also affects `typeof AbstractMiddleware` constraints in:

- `src/modules/AbstractController.ts:10–30` (middleware lists/tuples).
- `src/services/http/routing/RouteNode.ts:51–53` (`MiddlewareEntry`).
- `src/services/http/routing/middlewareNormalization.ts:10` (accepted authoring forms).

Require positive compilation of both versions in real route registration forms, and negative
sync/async/one-branch forgotten-return cases against the actual exported v2 base. The current fixture
correctly rejects those three examples, but only for its synthetic base.

## 2. [P1] Preserve the v1 calling convention without preserving its inner error normalization

P1m lines 342–343 say the v2 controller wrapper lets errors escape while v1 is unchanged. Existing
v1 validation and handler catches (`src/controllers/index.ts:503–538`) resolve errors into response
descriptors before an outer v2 wrapper sees them.

**Trigger:** a v2 transaction wraps a v1 controller whose handler or validator throws. The v1 catch
returns a 400/500 descriptor, `await next()` fulfills, and the transaction takes its commit path.
That contradicts the claimed original-error unwind for mixed routes (which P1m explicitly supports).

When a legacy handler participates in the portable chain, retain its `(req, res, next)` invocation
but move/parameterize error normalization so uncommitted errors reach outer wrappers first. Keep
the existing behavior for the old standalone dispatch path. Alternatively, explicitly restrict
the bridge guarantee; silently keeping both promises is not implementable.

The middleware bridge also needs deliberate treatment of `next(error)`, synchronous throws and
Promise rejections. Today's `settle` wraps non-Error values and ignores falsy error values
(`ExpressAdapter.ts:180–203`); copying it verbatim does not implement raw-throw identity.

## 3. [P1] Specify the complete legacy terminal outcome, not only a writer-skipped `sent` kind

An explicit legacy terminal descriptor is preferable to pretending that `undefined` is a response.
It can keep `Next` non-void. However, final recommendation lines 196–202 only say that the writer
skips `sent`, replacement errors, and abort rejects. The bridge still needs the following rules:

| Legacy event                                                  | Required bridge behavior                                                                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1 middleware calls `next()`                                  | Advance exactly once, retain legacy callback semantics, and run the suffix inside any enclosing v2 context. A v1 middleware's own ALS scope does not acquire new wrapping semantics automatically.              |
| v1 handler returns `void` / `pipe(res)` before the first byte | Track the pending legacy send explicitly; do not manufacture `sent` from `undefined` while no response has started. Today's adapter permits later raw writes (`ExpressAdapter.ts:133–153`).                     |
| v1 code commits headers/body                                  | Flush already-staged portable headers/cookies at the legacy write boundary, or explicitly narrow that guarantee. Waiting for the normal writer is too late. Reject later staging instead of silently losing it. |
| v1 response finishes normally                                 | Yield the defined terminal outcome; skip ordinary transformation/rendering; deliver completion once even if the legacy response finished before the bridge unwound.                                             |
| v1 response closes prematurely                                | Reject using the request's abort reason and report `aborted`, rather than treating close as successful finish.                                                                                                  |
| Outer middleware replaces `sent` or throws after raw commit   | Report the misuse/failure without attempting a second HTTP response. Use actual transport state independently of the returned object.                                                                           |

The staged-header issue is concrete: P1m lines 24, 178 and 344–346 promise writer-time merging,
while the `sent` writer is skipped. `ctx.response.setCookie(...); return next()` followed by
legacy `res.json(...)` cannot acquire the cookie after bytes have gone out.

Today's v1 bridge resolves on both `finish` and `close` (`ExpressAdapter.ts:205–208`). It therefore
cannot be reused unchanged to implement the promised abort rejection. A lazily constructed signal
must also reflect an abort that already occurred.

Define the descriptor's visible type and safe inspection/forwarding rules. Adding `kind: 'sent'`
to the public response union is a temporary public type change even if its factory is internal;
do not hide it with an unsound cast. It represents an already committed side effect, not a normal
replaceable response. Descriptor-path ordering cannot be retroactively imposed on legacy raw writes.

## 4. [P1] Guard the whole started suffix and expire each completed layer

The proposal required accounting for started downstream work before writing and refusing a layer's
continuation after that invocation settled. The checked `safe` and `dev` runners are weaker:

- `finish()` waits only for `req.handler` (`contract-check.mjs:46–55`). A middleware can call
  `next()` without returning it while a downstream wrapper awaits cleanup in `finally`. Both
  modes return the selected 202 before that cleanup finishes.
- `guardedNext()` checks only request-wide `req.settled` (`58–68`). A middleware that saved its
  continuation and returned 403 can still invoke the handler while an outer wrapper is awaiting
  work. Both modes returned 403 **after the supposedly blocked handler ran once**.

The latter window is acknowledged in final recommendation lines 234–237, but it cannot be treated
as merely a development diagnostic while claiming the stronger short-circuit/expiry rule.

**Required change:** define and enforce per-invocation expiry, and account for all already-started
downstream execution/cleanup, including async middleware before the handler and wrapper work after
it. This does not promise cancellation of arbitrary detached tasks or database work. Add these
cases before reusing the kernels as production templates, then remeasure the actual guards.

## 5. [P2] `Next` must actually return a Promise in production mode

`guardedNext()` directly returns `start()` (`contract-check.mjs:65–68`). A synchronous downstream
short-circuit returns a response object, so this valid consumer of the published type fails:

```ts
middleware(ctx, next) {
  return next().then((response) => response);
}
```

With a synchronous downstream 403, `safe` throws `next(...).then is not a function`; `dev` succeeds
because `checkLayer` happens to wrap the value in a Promise. This is a semantic difference between
production and development, not just additional diagnostics.

Normalize continuation results and synchronous exceptions at the boundary while retaining useful
promise-identity fast paths where correct. Test synchronous/async early responses and errors using
the public Promise API, not only `await next()` (which also accepts non-Promise values).

## 6. [P2] Finish the public completion shape and replace the blanket conformance claim

P1m's interface at 153–159 still exposes `{ status, aborted, durationMs }`, while its settled table
and final recommendation use `{ outcome: 'finished' | 'aborted' | 'failed', ... }`. The documented
logger reads `outcome`. Update the actual interface and define status/error availability and the
exactly-once finish/error/close policy.

`contract-check.mjs` currently has no v1 bridge, `sent`, writer, `onFinish`, abort, staged-header or
replaced-stream cases. Its R8 test only demonstrates that an iterator is read after transaction
closure. It also prints observations rather than asserting every required result or failing on a
false result; optional OTel loading silently skips when unavailable. It is not yet a sufficient
production acceptance gate for P1m lines 384–387.

Targeted review of the existing writer found preexisting cases that should be included as the new
lifecycle is implemented (these are not regressions introduced by the plan):

- A pending first `iterator.next()` stays awaited after disconnect even when `return()` resolves
  (`ExpressResponseWriter.ts:214–230`); `write()` does not settle.
- A synchronously throwing iterator `return()` escapes the close listener before
  `Promise.resolve(...).catch(...)` can handle it (`215–216`).
- `transformResponse` replacing a stream descriptor with an empty response leaves the discarded
  source uncancelled (`85–90`). The settled contract explicitly promises replacement cancellation.

These were reproduced against the actual writer with in-memory transport doubles. Real HTTP tests
should cover first-chunk and later-chunk abort, cancellation failure, source replacement, and one
completion notification with restored framework context.

## Files and acceptance criteria to add before implementation

The current list names the main runtime areas, but is not exhaustive enough for the chosen bridge:

- Add the selected v2 base module and `src/modules/AbstractController.ts`.
- Add `routing/RouteNode.ts`, `routing/middlewareNormalization.ts` and their tests for mixed
  constructor/metadata contracts and retained handler execution version.
- Record controller version when turning methods into bound `HandlerEntry` functions. Define
  defaults/opt-in for ad-hoc handlers and inheritance: changing a subclass's version must not
  silently invoke an inherited v1 method as `(ctx)`. Test discovery, class/instance registration
  and ad-hoc routes.
- Replace `src/codegen/*` with the selected exact resolver/emitter/type-fixture changes. Either
  emit both request/context aliases or explicitly carry controller version through the AST model.
  Preserve schema outputs and middleware `provides` in both forms.
- Include `src/server.ts` and `services/http/builtinErrorHandlers.ts` in the extension-hook decision:
  `TransformResponseHook`, `ErrorHandlerFn` and registry calls still receive Express-derived
  `FrameworkRequest`. Specify how v5 compatibility is preserved around a portable core.
- Correct the accessor export location. `src/index.ts` boots a server and is not a package export.
  Use a side-effect-free service subpath and exercise its exact published import in packaging smoke.
- Update the lockfile with the direct cookie dependency. Add cookie/header precedence, error
  responses, append/delete behavior and legacy-commit cases to acceptance tests.
- Distinguish route-only context creation from request-entry instrumentation. Global v1 middleware
  can remain in v5, but define how parser failures and 404/405 get the promised context/completion
  behavior, or explicitly limit the first release's guarantee.

The minimum additional done criteria are: real-package mixed-version type fixtures; mixed-route
raw errors/rollback; all legacy outcome cases above; per-layer continuation expiry; waiting for
downstream cleanup; Promise-return parity in safe/dev; real response completion/cancellation;
portable extension types or explicit legacy adapters; and packed imports of the new public API.
Keep the repository's existing full verification gates and runtime matrix.

## Verification and reproduction

Run on Node 26.12.1 against the reviewed commit:

- `node .plans/refactor/reference/middleware-experiments/contract-check.mjs conformance`: exited 0;
  12 result rows. For onion safe/dev, ten boolean cases reported true, the OTel case was skipped
  because its configured packages were unavailable, and R8 reported transaction-closed text.
  This review does not claim a fresh Node 24/Bun/OTel verification.
- `contract-types.ts` with TypeScript strict/no-emit: the expected TS2416 diagnostics for
  `ForgotSync`, `ForgotAsync` and `ForgotBranch`; no diagnostic for `Auth` or `Unawaited`.
- New [review probes](middleware-experiments/contract-review-probes.mjs): six checks against the
  unmodified kernel functions, five fail as described above, exit code 1. Both modes fail cleanup
  and per-layer expiry; only safe fails Promise return. This failing result is intentional evidence
  of unresolved findings, not a passing validation claim.

```sh
node .plans/refactor/reference/middleware-experiments/contract-review-probes.mjs
```

The review probes load the existing kernel prefix without executing its benchmark CLI. They modify
neither the kernels nor production runtime. No performance reruns or broad production test reruns
were needed for this review. The new report/probe formatting is checked with `npm run check` and
the diff with `git diff --check`; the settled plan itself is left unchanged for the owner/reviewer.
