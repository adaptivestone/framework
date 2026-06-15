# Side — `.select()` projection typing

**Status**: 💡 idea / deferred (typing track, far horizon)
**Depends on**: nothing (builds on the existing `GetModelTypeFromClass` machinery in `src/modules/BaseModel.ts`)
**Unblocks**: nothing

## Goal (one-line)

Make `Model.find().select(...)` / `.findOne().select(...)` narrow the returned
document type to the projected fields, so a `.select('name email')` result is
typed `{ name; email; _id }` instead of the full doc — matching what's actually
returned at runtime, with no cast.

## Why (origin)

Requested 2026-06-15. Previously judged "not worth covering" as a *test* case
(see the Remaining-cases audit — `.select()` listed under mongoose-territory
skips), but the ask now is the *feature*: generation/typing of the projection,
not just a fixture. This doc revisits that call as a roadmap item.

Refs are the biggest cast source; `.select()` is the second — every place a
handler narrows a query then reads only the projected fields currently sees the
full type and either over-reads or casts.

## Detail / design sketch

Mongoose returns the full hydrated-doc type from `.select()` regardless of the
projection; TS has no built-in narrowing. To type it we'd intercept `.select()`
at the query level and resolve the projection at the type level:

- **String form** — `.select('name email')` (include) and `.select('-password')`
  (exclude) need template-literal parsing: split on whitespace, classify each
  token as include/exclude, `Pick`/`Omit` on the doc type. `_id` is included by
  default unless `-_id`. Inclusion and exclusion **cannot** be mixed in one
  projection (mongoose throws) — the type should mirror that (a malformed mixed
  projection → keep full type, or error).
- **Object form** — `.select({ name: 1, email: 1 })` / `.select({ password: 0 })`
  is easier to parse (keys + `1|0|true|false`), no template-literal gymnastics.
- **Where it hooks** — a typed `select` query helper / override on the query
  type returned by `find`/`findOne`/`findById`, threaded through the model's
  `TQueryHelpers`. Must preserve `.lean()` / chaining / `await` resolution.

### Honest difficulty (scope discipline)

This is **fragile, high-surface** type machinery on the same layer that already
produced the rc.8 (Schema-instance TS2615) and rc.6 (env-determinism)
regressions. Template-literal string parsing at the type level is brittle across
mongoose-version bumps. Before building:

1. Confirm the cast volume in a real consumer (insailing) actually justifies it —
   if there are only a handful of `.select()` sites, a documented per-call
   generic (`.select<Pick<Doc,'name'>>(...)` or a small helper) is the
   proportionate answer, not new global machinery.
2. Scope to the **object form first** (parseable, no template-literal risk);
   add string-form parsing only if the object form proves insufficient.
3. **Mandatory** per the typing PRINCIPLE: land a permanent tsc-gate fixture in
   `src/models/__fixtures__/` (include, exclude, `_id` default, mixed→full,
   `.lean()` interaction) *before* touching the machinery — and re-run the whole
   7-fixture gate + framework tsc + build/declaration-emit + smoke afterward.

## Out of scope

Aggregation `$project`, `findOneAndUpdate` projection options, populated-path
projections. Mixing include+exclude (mongoose itself rejects it). Runtime
behavior is unchanged — this is `.d.ts`/type-only.
