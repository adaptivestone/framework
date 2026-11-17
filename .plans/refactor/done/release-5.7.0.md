# Prepare framework 5.7.0

## Goal and decisions

Prepare **5.7.0** (the user chose a minor, 2026-11-15): typed HTTP responses,
phases 0–2 of [universal HTTP responses](../active/universal-http-responses.md)
(P1q), with [request-validation 400s through the registry](validation-errors-registry.md).

- **Source.** The work was built on the branch `ccr-80ccfb40-0qs0lo` (78 commits).
  By the user's decision it is not merged: each commit was replayed on top of
  5.6.1, checked, and committed again under the owner's authorship, without
  trailers.
- **Scope.** 5.7.0 takes the response commits (the first 47 of the branch). Its
  commit 896e970 is skipped: the `ValidationError` declaration fix shipped in
  5.6.1.
- **Not in 5.7.0: the middleware rework** (P1m, the remaining 31 commits). As
  built it breaks 5.6 apps: overrides of a built-in `middleware(req, res, next)`
  are refused, `getMiddleware()` is gone, `RateLimiter.generateConsumeKey`
  receives the request context, and bodies are parsed after routing. It waits
  for a compatibility decision (shims in 5.x, or v6).
- **Not on main: the middleware and v6 design documents** (user decision,
  2026-11-16). The 34 plan-only commits of the 2026-10-31 to 2026-11-01 design
  round (reference documents, experiments, the v6 stability checklist, design
  edits to the middleware and adapter plans) stay on the `plans/middleware-design`
  branch and return with the middleware release.
- **OpenAPI response contracts are 5.8** (user decision, 2026-11-16): P1q
  Phase 3 needs only phases 0–2 and is built from main after this release.

### Replay adaptations

- Conflicts with 5.6.1 were resolved in `HttpServer.ts` (imports),
  `builtinErrorHandlers.ts` (`RegistrableError` placement) and
  `tests/fixtures/testBootstrapServer.ts` (both sides kept).
- The 5.6.1 test for inherited middleware schemas reads the returned response
  and expects `error: 'VALIDATION_FAILED'`.
- The packaging smoke consumer's `ValidationError` handler returns
  `HttpResponse.json(422, …)`.

### Pre-release review

Two independent model reviews read the replayed branch. Every finding was
checked against the code before it was acted on.

Fixed, each with a regression test:

- A stream that fails to commit its first chunk (for example an invalid
  `contentType`) left its source running. The source is now stopped on any
  failure; the response is destroyed only when headers were already sent.
- A `transformResponse` that returns a Promise which later rejects produced an
  unhandled rejection. The rejection is consumed; the original response is sent
  and the misuse is logged, as before.
- A `ValidationError` handler that threw, or returned an invalid result, was
  answered with the validation 400. A failed handler is a server defect: it
  answers 500. The work branch's later `services/http/answerError.ts` has the
  same defect, so the middleware replay must carry this fix.

Disclosed in the changelog, not changed:

- An override annotated `Promise<Response>` that returns a built-in handler's
  result no longer compiles.
- A `{ status, body }` error result sets its own `Content-Type`; without a body
  it adds none, and a 304 gets no `ETag`.

Not taken: three further test suggestions (disconnect during drain, cancelling
a native body, a stream failing in the final sink after headers).

### Built-in response bridge (2026-11-16)

`Auth`, `Home` and `Health` return their responses, and
`services/http/builtInResponse.ts` keeps overrides that call them without
returning the result working. A check of override shapes through the adapter
found two gaps:

- **Fixed.** An override calling the built-in handler with neither `await` nor
  `return` answered in 5.6 and hung, because the response is produced after
  the override finishes. The adapter now claims the response
  (`claimBuiltInResponse`): at once if there is one, else when it arrives,
  unless the handler answered meanwhile.
- **Disclosed.** The response of an awaited call is sent when the override
  finishes, so code after the call runs first, and a throw there answers with
  the error response. The bridge cannot tell an old override from a new one at
  that point, and this is the v6 rule.

The bridge is marked transitional in the source and is on the v6 removal list
in the plan index.

### Second review (2026-11-17)

After PR #84 merged, an independent Opus review read the release diff
(`5.6.1..release/5.7.0`), and another checked the documentation branch against
the source. Every finding was reproduced before it was acted on.

Fixed, each with a regression test:

- A `transformResponse` that returned a stream wrapping the original body got an
  empty body (status 200, nothing logged): the original source was stopped
  before the wrapper read it. It is now stopped after rendering.
- A handler that wrote to `res` and also returned a response had its own large
  `res` body cut off (the error went to the default finalizer, which destroys
  the socket). The adapter now logs, stops the returned body and leaves `res`
  alone.
- A handled request `ValidationError` was logged as `[object Object]`. The log
  line now lists the field paths, without values.
- Bridge: after `await super.x(req, res)` a 5.6 override reads the outcome from
  `res.statusCode`, which stayed at its default. The bridge now shows the
  produced status on `res`.
- Bridge: the late send introduced on 2026-11-16 fired before an override that
  chained on the handler's promise could answer. It now waits one tick.

Disclosed in the changelog and README, not changed:

- Framework-built JSON responses replace a `Content-Type` set on `res` earlier.
- An override that answers through `res` after it has returned gets the
  built-in response sent first.
- `transformResponse` does not see the CORS preflight 204 and the rate limiter's
  500 for a broken setup.

Corrected text: the error codes cover validation, routing, body-parsing and
server errors, not the built-in `Auth` and `Health` controllers' own answers;
"status and body unchanged" became "status and message unchanged" where the
body gains its code.

## Files

- Responses: `src/services/http/responses.ts`, `ResponseWriter.ts`,
  `ExpressResponseWriter.ts`, `routing/ExpressAdapter.ts`, `src/server.ts`
  (`transformResponse`).
- Errors: `src/services/http/HttpServer.ts`, `builtinErrorHandlers.ts`,
  `httpErrors.ts` (`FRAMEWORK_ERROR_CODES`), `middleware/RequestParser.ts`,
  `middleware/RateLimiter.ts`, `src/controllers/index.ts`.
- Built-in controllers: `src/controllers/Auth.ts`, `Health.ts`, `Home.ts`,
  `src/services/http/builtInResponse.ts`.
- Tests and fixtures next to each file; `scripts/fixtures/optional-i18n.mts`.
- Release: `package.json`, `package-lock.json` (version), `CHANGELOG.md` (5.7.0,
  dated 2026-11-17, the planned release day), `README.md` (5.7.0 upgrade notes),
  this card, `.plans/refactor/README.md`, `active/universal-http-responses.md`,
  `queued/openapi-responses.md`.
- Documentation repo: worktree `../framework-documenation-github-5.7.0`, local
  branch `docs/5.7.0` from `origin/main`: the earlier draft of the response pages
  replayed under the owner's authorship, then aligned with the final behavior.
  `06-Controllers/05-responses.md` (new), `04-error-handling.md` (validation
  errors, error codes, error-result rules), `02-routes.md`, `03-middleware.md`,
  `08-i18n.md` (error codes in the tables), `09-testsing.md`, `15-recipes.md`.
  Upgrade notes are inline `Upgrading to 5.7.0` blocks, as for earlier releases.
  Site build passes. The alignment found one wrong claim in the release PR text
  (`HttpResponse.empty(200)` compiles; only 1xx and 206 are rejected there),
  corrected before the release, and two imprecise changelog sentences (the
  built-in handlers' return types, the bodiless error result), reworded.

## Verification results — 2026-11-17

Final state, after the second review's fixes. Run in a clean copy of the branch
(a separate worktree), so nothing else in the working directory took part.

- npm latest is 5.6.1; 5.7.0 is not published.
- Node 26.13.1 suite: 1076/1076 passed, no skips, with `REDIS_URI` set against a
  disposable Redis container.
- Biome, main and test TypeScript checks (one checker, cold) passed.
- Packaging smoke passed.
- Bun 1.4.4 suite: 1050/1050 passed. The Bun packed consumer passed boot, HTTP,
  real MongoDB CRUD, password hashing and clean shutdown with
  `SMOKE_REQUIRE_MONGO=1` against a disposable `mongo:8` container. Both
  containers were removed afterwards.
- Replay check (2026-11-16, before the second review): outside `.plans`, the
  release branch equalled the full replay (`plans/middleware-design`) plus the
  bridge fix and the release commit. The plan documents have no new broken
  links.
- Each fix from the reviews and the bridge checks has a test that fails without
  it; the reviewers' probe scripts were rerun after the fixes.
- CI on PR #84 passed (34 checks) before the release commit.
- Local checks do not replace the remote Node/Bun CI matrix.

## Completion

Preparation complete. At the user's request, Claude replayed and committed the
work on `release/5.7.0`, pushed it and opened PR #84, which the user reviewed
and merged on 2026-11-16, and docs PR #42. The release commit follows in its
own PR. No tag, npm publication or GitHub release yet; the user merges and
publishes, then the tag and the GitHub release follow.

Next: OpenAPI response contracts as 5.8, then the middleware replay with its
compatibility decision. Earlier follow-ups stay open: replace `deepmerge` with
an internal config merge helper, and make Node 26 the floor in v6.
