# P1o — Mongoose validation safety net (escaped model errors → 400 when provably client data)

**Status**: ✅ done — shipped 2026-07-05 (commit 905b217; v5.1 behavior change, flagged in CHANGELOG Unreleased)
**Depends on**: nothing hard. Complements [params-validation](params-validation.md) (P1b+) — that one is *query-side* CastError, this one is *save-side* ValidationError.
**Origin**: 2026-07-05. Route validates `request:`/`query:` → 400 with field errors. But when a route schema doesn't mirror a model constraint (e.g. `name` with `maxLength: 50`, client sends 100 chars), the value passes route validation and `doc.save()` throws a Mongoose `ValidationError`, which falls into the wrapped handler's generic catch (`src/controllers/index.ts` ~458) → blanket **500 "Platform error"**. The client did nothing "server-error" worthy, but gets a 500 and no clue what to fix.

Naive fix (echo Mongoose field errors as 400) is unsafe: Mongoose errors are keyed by **model paths**, and the API field ↔ model path mapping lives only in controller code (`name` outside can be `userName` inside; internal fields exist that the client never sees). Echoing them would leak non-public field names and misattribute server-side bugs to the client.

Key insight: by the time the handler runs, `req.appInfo.request` / `req.appInfo.query` hold the validated input — their keys **are** the public field names for this route. Match Mongoose's failing paths against them.

## Goal

An escaped Mongoose `ValidationError` becomes an actionable **400 with per-field detail** when — and only when — every failing path corresponds to a field the client actually sent. Anything else stays an honest 500. No internal names ever reach the client.

## Design

In the wrapped-handler catch (`src/controllers/index.ts` ~458–468), before the blanket 500:

1. `res.headersSent` guard stays first, unchanged.
2. If `err instanceof mongoose.Error.ValidationError` (mongoose is a required dep — real instanceof, no duck-typing; NOT the framework's own route-level `ValidationError`, which never reaches this catch):
   - **Failing paths** = `Object.keys(err.errors)` (e.g. `name`, `profile.name`).
   - **Route input keys** = keys of `req.appInfo.request` ∪ `req.appInfo.query`. Exclude the framework-injected `contentType` key (it's not client data).
   - A path **matches** when its first segment (`path.split('.')[0]`) is a route input key. Nested paths report under the full path (`profile.name`) — not a leak, the client owns that subtree.
   - **ALL paths match** → `400` with the standard shape `{ errors: { <path>: message } }` (same as route validation). Messages pass through from Mongoose; per-schema custom messages are the customization point.
   - **ANY path unmatched** (renamed / internal) → keep today's `500`. Strict on purpose: 400 only when the failure is provably *entirely* the client's data. A mixed failure includes a server-side bug; a 400 would tell the client "fix your field" only for them to hit the 500 anyway.
   - Corollary: a route with no `request:`/`query:` schema has no input keys → nothing matches → 500 stays. Without a declared contract the framework can't attribute anything to the client.
3. **Logging**: matched → `logger.warn` with the full error (handled, but signals the route schema is missing a constraint the developer should mirror). Unmatched → `logger.error`, exactly as today.

Known accepted edge: matching is by name. A route field that coincidentally shares a name with a model path populated from elsewhere yields a plausible-but-misattributed message. Rare; failure mode is a slightly wrong message, not a leak.

## Files touched

- `src/controllers/index.ts` — the catch block ~458–468 (+ mongoose import).
- Tests (`src/controllers/index.test.ts` + fixture model with `maxLength` / fixture route):
  - matched field → 400 with per-field detail, warn logged;
  - renamed field (`name` → `userName`) → 500;
  - internal field failing → 500;
  - mixed (one matched + one internal) → 500, full detail in log;
  - route-level `ValidationError` still handled by the existing pre-handler 400 path (no cross-talk between the two `ValidationError` types);
  - `headersSent` → `next(err)` unchanged.
- `CHANGELOG.md` — v5.1 entry, flagged as behavior change.
- Docs repo (follow-up at implementation): recipe keeps "mirror model constraints in the route schema" as the primary practice; safety net documented as fallback, not contract.

## API change

```ts
// Model: name: { type: String, maxLength: 50 }
// Route: request: yup.object({ name: yup.string().required() })  // forgot .max(50)

// before — POST { name: <100 chars> }:
// 500 { message: 'Platform error. Please check later or contact support' }

// after:
// 400 { errors: { name: 'Path `name` (`…`) is longer than the maximum allowed length (50).' } }
// (and a warn in logs: route schema is missing the constraint)

// but if the model field is `userName` (renamed) or internal → still 500 (server-side gap, not client data)
```

## Open questions

- **400 vs 422**: 400 recommended — consistent with route validation errors. Revisit only if consumers ask.
- **i18n of Mongoose messages**: pass-through (English / per-schema custom messages) in v1. Wiring them through the i18n layer is possible later but adds surface for little gain.

## Out of scope

- Standalone `CastError` from queries (`findById` with malformed id) — that's [params-validation](params-validation.md).
- A model-path → public-name mapping config (opt-in detailed errors for renamed fields) — add only if real demand appears.
- Deriving route schemas from model schemas (single source of truth) — rejected as premature abstraction; the route schema stays the API contract.
- Handlers throwing the framework's own `ValidationError` for a manual 400 — separate idea, not this plan.

## Done when

A save that violates a model constraint on a client-sent field returns 400 with the standard error shape and a warn log; renamed/internal/mixed failures stay 500; no internal field name ever appears in a response. Changelog flags the behavior change. Tests green. Docs recipe updated (docs repo).
