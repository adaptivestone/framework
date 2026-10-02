# Built-in health endpoints

**Status**: ✅ implemented 2026-10-02; unreleased
**Release**: next minor `5.5.0` (additive)
**Origin**: consumer feedback — every deployed app registers its own `/health` in `bootHttp` and
deploys depend on it; an optional MongoDB ping makes it more useful. First slice of
[P2b observability](../later/observability.md) (`/livez` + `/readyz` there; paths changed here).

## Decision

A built-in `Health` controller (`src/controllers/Health.ts`), overridable by file inheritance like
`Auth`/`Home` — an app's `controllers/Health.ts` can extend it to add checks or middleware.

- `GET /health/live` → 200 `{ status: 'ok' }`. Process only — never a dependency: a liveness probe
  that pinged Mongo would restart every pod on a database blip (Rails/Laravel `/up` check nothing
  for the same reason).
- `GET /health/ready` → Mongo ping with a 1 s timeout: 200 `{ status: 'ok', checks: { mongo: 'ok' } }`
  or 503 `{ status: 'error', checks: { mongo: 'error' } }`, no error details (public endpoint); the
  failure is logged at `warn`. Mongo is always configured (boot requires it), so the check always applies.
- No route on `/health` itself: an app registering `GET /health` (common today) would collide, and a
  duplicate route throws at boot — the upgrade must not break it.
- Mount `/health` = the default from the class name. Not configurable: codegen needs a literal
  `getHttpPath()` (a config read is "not analyzable" and fails `gen`), so an app moves it by
  overriding `getHttpPath()` with a literal in its own `Health.ts`.
- `config/health.ts`: `token` (`HEALTH_TOKEN`, unset = open). With a token, requests must send it as `X-Health-Token` (preferred) or `?token=` (load balancers
  such as AWS ALB cannot send headers); constant-time comparison; missing/wrong → 401
  `{ message }` (404 would make a misconfigured probe look like a missing route).
- Controller `static get middleware()` is empty: the inherited `[GetUserByToken, Auth]` default
  would demand a user session.
- `RequestLogger` skips requests under `/health/` (the default mount), except finished ones with
  status ≥ 400 (logged at `warn`) — probes every few seconds would otherwise flood the log. An app
  that moves the controller keeps normal request logging there.
- Health bodies are an operational format (`{ status, checks }`), not the API error contract:
  probes read the status code.

## Out of scope

The check registry and `/startupz` — P2b, on demand; the open problem (how optional services such
as Redis get registered for readiness) is recorded there under "Known problem". Until then, apps
add checks in a `Health` override. Metrics.

## Files

`src/controllers/Health.ts` (+ test), `src/config/health.ts`,
`src/services/http/middleware/RequestLogger.ts` (+ test), `CHANGELOG.md`, `later/observability.md`,
README; docs repo: deploy + controllers chapters.

## Done when

Both endpoints answer as above (ready → 503 when the ping fails or times out); token: open when
unset, header and query accepted, missing/wrong → 401; an app's own `GET /health` still registers;
successful probes are not request-logged; the AGENTS.md gates pass.
