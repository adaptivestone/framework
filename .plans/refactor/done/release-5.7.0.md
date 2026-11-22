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

### Stream cancellation and copied-request review (2026-11-17)

Two further release-blocking review findings are fixed on `release/5.7.0`:

- Node `Readable` cancellation explicitly destroys the source, including HEAD,
  disconnect during a pending read and a discarded transform body. A listener
  handles asynchronous open/destroy errors until close. Iterator `return()` alone
  neither closes an unread file nor interrupts a pending read.
- The built-in response bridge keys responses by the explicitly supplied `res`,
  retaining a request-only fallback. Overrides may forward a copied request
  (including one without `req.res`) and still drop the returned descriptor. Both
  keys share a single claim; the previous status mirroring and next-tick send
  are preserved. The adapter also skips a late send after client disconnect.

Regression tests cover unread/missing files, disconnect before the first chunk,
transform replacement, an actual `Auth` override with normalized copied input,
request-only `Home`, and a late copied `Health` request with exactly one send.

Verification after these fixes (2026-11-17): Node 26.13.1 `npm test` passed
1083/1083, no skips or cancellations, with a disposable Redis and test concurrency
limited to two. Biome, both TypeScript checks (one checker, separate incremental
caches), and `npm run smoke` passed. All seven new regression tests also passed
on Bun 1.4.4, including an error queued by an already-destroyed Node stream.
The full Bun matrix is left to the updated PR's CI.

Independent rerun of every gate on that commit (`75f9c55`), the same day: Node
1083/1083 with Redis and no skips, Bun 1.4.4 1057/1057, Biome, both TypeScript
checks, packaging smoke, and the Bun packed consumer against a disposable
`mongo:8`. CI on PR #85 passed (33 checks). The earlier reviews' probe scripts
give the same results as before these fixes. The changelog entries this commit
added under `Unreleased` were removed afterwards: both fixes repair code that
was never released, and the 5.7.0 section already describes the resulting
behavior.

### Third review (2026-11-17)

Two more independent model reviews read `5.6.1..cff6929` at their highest
reasoning setting, and both advised against publishing. One run was stopped by
its provider's content filter before the report; resumed, it reported what it
had confirmed. The main findings were reproduced with probe scripts, the rest
with a test that failed before its fix.

Fixed, each with a regression test:

- A Node stream that `transformResponse` replaced could emit `'error'` before
  anyone listened (a file that fails to open while the replacement renders):
  an uncaught exception, so the process exited. A replaced Node source now gets
  a no-op error listener before rendering.
- Bridge: an override passing a wrapper of `res` to the built-in handler got no
  answer. The response is recorded under both `req` and `res`, and the status
  is shown on both the given and the request's own `res`.
- The "error handler failed" mark stayed on a reused error object. Reading it
  now clears it.
- `toLoggableError` relabelled any error with an object `message`. Only the
  framework's `ValidationError` is rewritten, and only the number of failing
  fields is logged: a path can be a client-supplied key.
- A replaced `resolveError` that returned only the legacy fields left the
  request open (controller path) or answered 500 (final sink). The response is
  built from the legacy fields.
- Mixed write: the second review's fix stopped the returned body, which
  destroyed a stream the handler was also piping to `res`. The returned
  response is now left alone; `discardBody` is gone.
- `HttpResponse.native` also drops the headers its `Connection` header names.
- A `transformResponse` returning a Promise fulfilled with a response left that
  response's body open. It is stopped, unless it is the body being sent.
- A late bridge send that throws synchronously goes to `next(err)`.
- Hardenings: thrown non-Error values are formatted without throwing; the plain
  500 fallback is labelled `application/json`.
- `Home` and `Health` handlers declare `HttpResponse | Response`, like `Auth`:
  a subclass returning another response kind did not compile.
- Tests added for two guards that no test covered (a disconnected client gets
  no late send; a late request-only call is found through the request key).

Disclosed in the changelog and README, not changed:

- The built-in handlers no longer call `res.json` or `res.status`: a wrapper
  around `res` no longer intercepts their answer, and a status set before the
  call is replaced.
- Waiting inside an override for `res` to finish never completes.
- A built-in handler used directly as an Express route handler does not answer.
- An `HttpServer.resolveError` override must return `response` (types).
- Legacy error results: `Set-Cookie` is appended and `Vary` merged; a result
  without a body no longer answers 304 to a conditional request.
- A replacement stream that wraps the original owns stopping it; an async
  generator finishes its current step before it stops.
- `native` sends any status; the plain 500 fallback is not transformed.

Not taken:

- A 205 error result with an explicit `Content-Length`.
- A Web stream's reader left locked after a write, and a `drain` listener left
  after a disconnect during backpressure (both die with the request).
- Two copies of the framework in one app keep separate bridge state.
- The status mirrored on `res` is the descriptor's, so a conditional GET shows
  200 where the wire answer is 304.
- `JsonResponse<S, B, M>` annotations are not checked against the media type
  the factory sets. Recorded for the 5.8 OpenAPI work.
- The long-stream memory test can pass without measuring anything.

Verification after these fixes (2026-11-17), in a clean copy of the branch:
Node 26.13.1 1100/1100 with Redis and no skips, Bun 1.4.4 1074/1074, Biome,
both TypeScript checks, packaging smoke, and the Bun packed consumer against a
disposable `mongo:8`.

### Fourth review (2026-11-21)

The same two models reviewed `5.6.1..c3c508a` again, asked to separate release
blockers from follow-ups. Both confirmed the third round's fixes by running
them, and both still advised against publishing. Their blocker lists overlapped
on three points.

Fixed, each with a regression test:

- Mixed write: a returned Node stream that nobody reads (a file that fails to
  open) crashed the process once the third round stopped touching returned
  bodies. Such a stream is now destroyed; one that is being read (piped to
  `res`) keeps running, with its errors absorbed.
- A request `ValidationError` reached the log raw when a registered handler
  failed on it, and when it came from a second copy of the framework. Both
  paths now log the field count only (the class's cross-copy check is used).
- Bridge: a copy of `req` together with a wrapper of `res` found nothing. The
  response is also recorded under `req.res`. Showing the status on `res` is
  best effort: a read-only `statusCode` no longer throws.
- `HttpResponse.native` of a fetched response (non-empty `url`) forwarded the
  upstream `content-encoding` and `content-length` although `fetch` had decoded
  the body. Both are dropped for such a response.
- A legacy error result with an array header value (JavaScript apps): each
  `Set-Cookie` element stays its own field, as in 5.6.1.
- Merging `Vary` no longer fails the response on an empty or loosely spaced
  value; a value that is not a list of field names is sent as given.
- `RequestParser.middleware` declares `Promise<void | Response>` again, so a
  subclass that answers itself compiles.
- Taken back: the third round's cleanup of a late response from a
  Promise-returning `transformResponse`. It could abort the original response
  when the late one wrapped the same source.

After the owner asked why some findings were left alone, six more were fixed
(four of them from the "not taken" lists):

- A stream piped into `res` and also returned, before its first chunk: the
  pipe is visible on `res` at that moment, so it counts as a mixed write and
  the piped response is delivered in full.
- The "error handler failed" mark is kept per request, not per error object,
  so requests that throw the same error instance do not interfere.
- A legacy error result with header names that differ only by case: the last
  one wins, as before; cookies add up.
- A thrown value that cannot be converted to a string no longer breaks the log
  line that reports it (one shared formatter at the five places).
- A response without a body never carries a stated `Content-Length` (a 205
  result with one left the client waiting).
- The bridge state is shared between copies of the framework module.

Disclosed in the changelog and README, not changed:

- An Express error middleware the app mounts itself sees the body parser's 413
  and 400 before the framework answers them.
- A `resolveError` override must change `response` itself; the legacy fields no
  longer decide what is sent when it is present.

Not taken:

- A handler that returns a response and writes to `res` later, from a timer or
  a callback: nothing shows it when the handler returns.
- An Express JSON replacer no longer sees a body-less result; 204/205 results
  with a supplied body lose the generated `ETag`; statuses such as 600 fail
  only at run time.
- A Promise-returning transform's late response body is not stopped (see
  above; the fifth round releases an unread Node stream).

Verification after these fixes (2026-11-21), in a clean copy of the branch:
Node 26.13.1 1117/1117 with Redis and no skips, Bun 1.4.4 1091/1091, Biome,
both TypeScript checks, packaging smoke, and the Bun packed consumer against a
disposable `mongo:8`.

### Fifth review (2026-11-21)

The same two models reviewed `5.6.1..613382a` (the fourth round's fixes, not
yet in the release PR). Both confirmed the six owner-requested fixes by
running them. Three of their blockers were the same, and all three were gaps
in the fourth round's own fixes.

Fixed, each with a regression test:

- A Promise-returning `transformResponse` that fulfils with a stream of a file
  that fails to open crashed the process once the late body was left alone. An
  unread Node stream body of a late response is released (destroyed, errors
  absorbed); other bodies stay untouched, so the original is never aborted.
- The pipe check counted `'unpipe'` listeners on `res`, so an app middleware
  with such a listener suppressed every returned response. The adapter now
  listens for `'pipe'` while the handler runs.
- Body-less responses are framed as 5.6.1 framed them, also for `native`
  without a body: HEAD keeps its headers; a 204 or 304 drops its content
  headers; otherwise a `Content-Length` (stated or already on `res`) becomes 0.
- `native` drops the encoding, length and digest headers of a fetched response
  only when `fetch` decoded every listed coding (gzip, x-gzip, deflate, br,
  zstd; measured on Node 24, Node 26 and Bun). Another coding is passed on as
  received.
- A request `ValidationError` is logged as a field count wherever it was
  thrown, also from inside a handler (reverted in the seventh round).
- Bridge: the response is also recorded under the given `res`'s `req`.
- A rejection without a reason (a Web stream erroring with no argument) went to
  `next(undefined)` and fell through to the 404. It now reaches the error path.

Disclosed in the changelog: an Express `json replacer` no longer sees a result
without a body.

Not taken:

- A source piped into `res` and also returned that fails before its first
  chunk: its error is absorbed and `res` stays open, as a plain pipe leaves it.
- A paused, unread stream returned in a mixed write keeps its file descriptor.
- Middleware that calls `resolveError` itself, whose handler fails, followed by
  a route-schema failure on the same request: the mark is consumed by the
  second.
- A registered handler that rethrows the `ValidationError`: the handler-failure
  line shows `[object Object]` (no field data).

Verification after these fixes (2026-11-21), in a clean copy of the branch:
Node 26.13.1 1128/1128 with Redis and no skips, Bun 1.4.4 1102/1102, Biome,
both TypeScript checks, packaging smoke, and the Bun packed consumer against a
disposable `mongo:8`.

### Sixth review (2026-11-21)

The same two models reviewed `5.6.1..f5b63e5`. Half of their blockers were
again consequences of the previous round's fixes, so this round follows one
rule: the framework does not destroy a stream it does not own, and does not
change headers unless it is certain they are wrong.

Fixed, each with a regression test:

- The fifth round's pipe flag was sticky: a legacy streaming controller that
  piped an upstream into `res`, detached it after a failure and threw an
  `HttpError` got no answer (5.6.1 sent it). Only the sources still piped into
  `res` are tracked, and a mixed write is only the returned stream that is
  itself piped. Any other returned response is written as before.
- A request `ValidationError` thrown after the response started was logged raw
  (reverted in the seventh round).
- The late response of a Promise-returning `transformResponse` is never
  destroyed: a Node stream body only gets an error listener. Destroying it
  could truncate the original through a wrapper.
- Body-less framing: an inherited `Transfer-Encoding` is removed, and a 204 or
  304 drops its content headers for HEAD too.
- `native` drops the encoding headers of a fetched response only when it has a
  body, is not a 206 and names one coding. Stacked codings are not decoded by
  every runtime; a fetched HEAD keeps its metadata. To forward bytes exactly as
  received, the caller passes a constructed `Response`.
- A falsy rejection reason reaches the error path at every place the adapter
  passes a failure on (it fell through to the 404).
- Bridge: the status is shown on the request's own `res` reached through the
  given `res`.

Disclosed: a stream source yields a new chunk each time (chunks are not
copied, as with `res.write`); an Express `json replacer` no longer sees the
body-less `Auth` answers.

Not taken:

- Stacked codings that a runtime's `fetch` did decode keep their headers.
- A coding the app asked for explicitly on a runtime whose `fetch` does not
  decode it, for example `zstd` on an early Node 24.
- A fetched 206 whose body `fetch` decoded.

Verification after these fixes (2026-11-21), in a clean copy of the branch:
Node 26.13.1 1140/1140 with Redis and no skips, Bun 1.4.4 1114/1114, Biome,
both TypeScript checks, packaging smoke, and the Bun packed consumer against a
disposable `mongo:8`.

### Seventh review (2026-11-21)

The same two models reviewed `5.6.1..8c7c35c`. Sol had three blockers, Astra
five. None was a crash or hang in 5.7.0 code that the review rounds had not
touched: three came from the sixth round's own fixes, three were already in
5.6.1, the rest were rare bridge and `native` permutations.

Fixed, each with a regression test:

- A legacy override that piped a source into `res`, returned, and detached the
  source before a late built-in answer (`super.home`, `super.postLogin` not
  awaited) got no answer: the bridge still counted the pipe. The late answer is
  sent whenever nothing has been sent yet.
- Body-less framing follows 5.6.1 exactly. A 204 or 304 drops its content
  headers; a 205 states a zero length and drops a `Transfer-Encoding`, HEAD
  included; any other status keeps its `Transfer-Encoding` (a declared trailer
  needs chunked framing; removing it turned an empty 201 into a 500), and
  outside HEAD a `Content-Length` becomes 0.
- `native` with stacked codings follows the runtime's `fetch`: Node decodes
  every listed coding, so their headers are dropped; Bun decodes only one, so
  they are kept.
- The 404 page passed a failure without a reason to `next(undefined)`, which
  fell through to the default HTML 404. It now reaches the error path.
- Wording: the changelog's mixed-write and `native` sentences, and the README's
  note that a body-less error result no longer reaches a `json replacer`.

Reverted to 5.6.1: a request `ValidationError` thrown inside a handler (a 500,
or after the response started) is logged in full again, because the log is the
only place with its details. It stays a field count only on the path new in
5.7.0: a route-validation error whose registered handler failed, answered 500.

Not taken, owner's decision: what 5.6.1 already logged stays. The body-parser
line quotes `JSON.parse`'s message, which can contain part of the body; the
Mongoose safety-net warning names the full field path, which for a `Map`
schema can contain a client key. Both reviewers rate these blockers; they are
not regressions, and a change to what the framework logs about client errors
is a separate decision.

Not taken, rare misuse or already recorded:

- A fetched 206 whose body `fetch` decoded (sixth round): its headers are
  passed on as received.
- A source piped into `res` twice and unpiped once, or a returned stream that
  wraps a piped source: the mixed write is not detected.
- A late `transformResponse` stream that errors before the writer attaches its
  listener.
- A copied request and a wrapped response that point only to each other: the
  bridge cannot reach the real response; the shown status is best effort.

Verification after these fixes (2026-11-21), in a clean copy of the branch:
Node 26.13.1 1141/1141 with Redis and no skips, Bun 1.4.4 1115/1115, Biome,
both TypeScript checks, packaging smoke, and the Bun packed consumer against a
disposable `mongo:8`.

### Older issues fixed before release (2026-11-22)

An app moving onto 5.6.1 reported 25 framework problems (FW1–FW25), all
present in 5.6.1 and unchanged by 5.7.0. The owner chose to fix the real,
small ones in 5.7.0, a minor release, rather than wait. Each fix has a test
that fails without it.

Fixed:

- FW2: with `ip` disabled, a request lacking every enabled identity shares the
  route's bucket (the docs' login example did this for logged-out callers).
  Owner's decision: warn once per mount, do not change the key; the docs
  example is corrected. A mount with every identity disabled does not warn.
- FW5: a 5xx `HttpError` logs at `error` (was `verbose` for every status).
- FW6: a `'beforeShutdown'` event before the HTTP drain: the server stops
  accepting first (a reconnecting client cannot hold the drain), listeners
  are called as `emit` calls them and awaited for at most 3 s; open
  WebSockets no longer hold the drain until the forced exit.
- FW9: codegen warns about an annotated `get routes()` with schemas and
  suggests `satisfies RouteParams` (a golden fixture covers it).
- FW15: `User.generateToken` no longer requires an email.
- FW17: `ASF_DEP_USEROLD` only when the app uses `UserOld`.
- FW23: the `ru` locale has every framework key; a test checks every
  non-English locale against the keys the source uses. `en` stays
  `defaultValue`-only (see `i18n-default-values.md`).
- FW25: the timing-equalizer hash is computed when the HTTP server starts.
- FW26: a list or object sent to a yup `string().trim()` field answers the
  validation 400 (a `TypeError` is re-checked without transforms; other
  errors stay 500, so an outage inside a `.test()` is not re-run).
- FW27: yup issue params drop `resolved` (a `ref()`'s values, such as the
  password a `repeatPassword` must match), `spec` and `disableStackTrace`.
- FW10: the exported `File` type has the upload fields (it resolved to the
  global web `File`); the advice checks the file array as a whole, so errors
  stay under the field name.
- Found while checking this batch: an `application/octet-stream` body had no
  size limit. 5.6.1 excluded it from `maxFieldsSize` so that `maxFileSize`
  would apply, but Formidable checks file limits only on multipart parts.
  `RequestParser` now bounds it by `maxFileSize` (or `maxTotalFileSize`, if
  lower), for a declared length and for a streamed body.
- Text: `YupFile`'s replacement advice (FW10), the parser-limits note (FW4),
  the codegen command in the generated header (FW9).

Review of this batch: Astra 6.2 and Sol 6.2 (max effort) and an Opus reviewer
read `b7f0591..70d50b2` and the triage. Fixed from their findings, each with
a test: `beforeShutdown` called listeners without the emitter as `this` and
left `once` listeners registered, and accepted new connections while
listeners ran (a reconnecting SSE client held the drain); the exported
`RegisteredErrorHandler.logLevel` had become a union with a function (now a
plain level plus an internal `logLevelFor`); the limiter warning missed a
user without an `id`; the codegen warning now says an annotation _can_
widen. FW3 was reverted (below). The release text was corrected: the `ru`
catalog is not loaded for apps (copy its keys), the warm-up costs one hash
per process and an early login can wait for it, and committed generated
files need regenerating once.

Not taken:

- FW3: a framework `ValidationError` thrown from a handler stays a 500, as in
  5.6.1. It was briefly a 400, but the third review of this batch showed a
  handler that validates server-side data (an upstream reply, a stored
  record) would then send those values to the client, unlogged; translation,
  route middleware and directly registered routes also differed. Client field
  errors from a handler use `BadRequestError` with `errors`; the docs say so.
- FW19: `TLogConfig.redact` stays optional. An app's `config/log.ts` replaces
  the framework file, so `redact` can be absent; `appInfo.i18n` stays optional
  on `FrameworkRequest`, which types the request before the I18n middleware.
- Features or policy, for 5.8 or later: FW1 (rewriting error messages and
  stacks in logs, with the body-parser and Mongoose log lines above), FW7
  (crash on unhandled rejection), FW8 (log fields on the console), FW11
  (limiter normalizers, failure-only counting, backoff), FW12 (`i18nParams`),
  FW13 (an `HttpError` as a handler result), FW14 (Health `checks()`), FW15's
  TTL and metadata, FW16's test options, FW20 (more `HttpError` subclasses),
  FW21 (codes on the built-in `Auth` answers), FW22 (OpenAPI responses,
  planned for 5.8), and one list for the middleware codes `AUTH001` and
  `NO_ACCESS`.
- With the middleware rework: FW4 (per-route body limits, parsing after
  routing and auth).
- Later: FW18 (importable commands, required indexes).
- Docs only: FW13's recipe import, FW16's test-harness differences, FW24.
- From the review, for 5.8: config types taken from runtime values (FW9's
  second half), an `HttpError` returned from a registry handler, an opt-out
  for the warm-up hash; a locale test for stale extra keys.

Verification after these fixes (2026-11-22), in a clean copy of the branch:
Node 26.13.1 with Redis and no skips, 1174 of 1175 passed; the one cancelled
test (the `ExpressResponseWriter` memory test, timed out at load average 17)
passed twice in isolation. Bun 1.4.4 1149/1149, Biome, both TypeScript checks,
packaging smoke, and the Bun packed consumer against a disposable `mongo:8`.

### Second app report (2026-11-22)

A second app moving onto 5.6.1 and 5.7.0 reported seven more problems
(TH1–TH7), all present in 5.6.1. FW28, added to the first report after its
triage, was checked with them.

Fixed, each with a test that fails without it:

- TH1: after the HTTP drain a cluster worker closed IPC with
  `process.disconnect()`, and Node exits a worker at once on that, because
  only `cluster.worker.disconnect()` marks the exit as voluntary. The async
  `'shutdown'` listeners (redis quit, mongoose close, logger flush) were cut
  off while the exit reported 0. A cluster worker now calls
  `cluster.worker.disconnect()`; `emit('shutdown')` is unchanged. Same on Bun
  1.4.4. A worker now drains like a single process: a SIGTERM right after
  boot waits for the timing-equalizer hash, and a leaked handle exits 1 after
  the 10 s force timer instead of 0 at once (upgrade note in the README).
- TH2: a malformed `redis.url` makes the Redis client throw when built. The
  limiter keeps the misconfiguration 500 (as for a missing `@redis/client`);
  its error now names `redis.url`. Failing fast at boot or failing open is an
  open decision in the backlog card.
- TH5: a worker that exits with code 0 outside a shutdown is logged at `warn`
  with the number left (was `info`). A restart option is in the backlog card.
- FW28: the files of one multipart field keep the send order; Formidable
  listed them as their writes finished.

Not taken, now in
[app-upgrade-findings](../queued/app-upgrade-findings.md) with the items the
first report left open: TH3 (per-request rate limits), TH4 (duplicate-key
409), TH6 (process info in readiness), TH7 (exported password policy).

Review: an Opus reviewer checked that each new test fails on the old code
and passes with the fix, probed `cluster.worker.disconnect()` on Node 26 and
Bun 1.4.4 (no hang when the primary is gone; pm2 7 never reads
`exitedAfterDisconnect`), and found no blocker. Its text note (pm2's
`kill_timeout` or a short `shutdownTimeoutMs` kills a worker before the
10 s timer) is in the CHANGELOG and README.

Verification (2026-11-22), in a clean copy of the branch: Node 26.13.1
1178/1178 with Redis and no skips, Biome, both TypeScript checks, packaging
smoke, and the Bun packed consumer against a disposable `mongo:8`. Bun 1.4.4:
1145 of 1146; the one failure was a setup-hook timeout in
`I18n.test.ts` at load average 64, and the file passed twice in isolation.

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
  dated 2026-11-22, the planned release day), `README.md` (5.7.0 upgrade notes),
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

State after the second review's fixes, before the stream cancellation and
copied-request fixes above. Run in a clean copy of the branch
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
