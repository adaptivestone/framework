# P1n — Codegen AST front-end (oxc)

**Status**: 🚧 in flight (prototype ✅ 2026-06-07, see `docs/codegen-ast-approach.md` → "Prototype results")
**Target**: **v5 final (v5.0.0)** — build the full AST front-end before the final v5 tag (extends the rc). Non-breaking: AST is primary, the boot/ghost path stays as a fallback.
**Depends on**: P1b ✅ (registry/`flatten`), P1j Phase 2 ✅ (the shared `registerControllerInstance` / subtree seam)
**Sequences with**: supersedes the regex parser (`importResolution.ts`); folds in P1j Phase 3 (model detection); the final fallback removal IS P1j Phase 5 / [[static-middleware-cutover]].
**Time**: ~3–4 d, building into the final v5.0.0.
**Dependency**: `oxc-parser` is a **regular `dependency`** — codegen ships in the published package and runs in end-user projects (`npm run gen`), so the parser must be in *their* node_modules, not a devDep. (If native-binary install weight for non-codegen consumers becomes an issue, revisit as `optionalDependencies` + a friendly "run `npm i oxc-parser`" error — not now.)

## Goal (one-line)

Replace codegen's regex import-reconstruction + boot reflection with **one oxc AST source pass** that extracts routes/middleware/imports/extends declaratively, feeds the **existing** `RouteRegistry.flatten()`, and emits from binding **names** — and drive the **model/app-types** scan from the same pass. The boot/ghost path stays as a per-controller **fallback** for non-declarative `routes` getters (insurance; removed at v6).

## v5 vs v6 split (why this is a v5 release)

| Piece | Breaking? | Lands |
|---|---|---|
| AST extraction as the primary front-end | no (additive) | **v5.1** |
| Delete `importResolution.ts` (+ its bug class: regex/ASI/comments/backslash) | no — internal; fallback sources imports/middleware from AST too | **v5.1** |
| Model/app-types scan via AST (no `import()`) | no | **v5.1** |
| Boot/ghost retained as fallback for dynamic `routes` | no | **v5.1** |
| **Remove** the boot/ghost fallback (declarative-`routes`-only) | **yes** — mandates declarative controllers | **v6** (= P1j Ph5) |

P1j already audited two real consumer codebases (`tht-server`, `xtok-backend`): every `routes` getter is a declarative handler map → the fallback is insurance, not a hot path. So v5.1 gets ~all the win (no regex parser, ~50× faster, model scan import-free); v6 just deletes the safety net.

## Why oxc, not the TS API

`ts.createSourceFile` (the prototype's parser) is sunsetting: **TS 6 is the last JS-based release; TS 7 is the native Go port and drops the JS compiler API** (gRPC replacement not stable until ~7.1). knip moved off the TS API to oxc for the same reason (+2–4×). Codegen only needs *syntactic* extraction (it emits type expressions, never resolves types), so oxc — a stable in-process napi parser — is the durable fit. Sources in `docs/codegen-ast-approach.md`.

## Phases  (0–6 = v5.1 · 7 = v6)

### Phase 0 — De-risk (close the prototype gaps) — v5.1
Port the prototype extractor to **oxc**; cover the **bare-package-ancestor** extends-walk (consumer extending `@adaptivestone/framework/modules/…`) and a **real consumer-project** benchmark. Record declarative-coverage % + the fallback set.
*Done when:* oxc extractor reproduces today's `.gen.ts` chain bindings for framework + fixtures + ≥1 consumer.

### Phase 1 — Production extractor (additive) — v5.1
`src/codegen/astExtract.ts` (oxc): `{ imports, extends, routes, middleware } | { needsBoot, reason }`, with relative + bare-package extends recursion. Routes & middleware extracted **independently** (so a dynamic `routes` doesn't lose a literal `middleware`). Port the `importResolution.test.ts` cases (free with a real parser) + extraction cases.
*Done when:* `astExtract.test.ts` green; not yet wired in.

### Phase 2 — Decouple the subtree builder (riskiest) — v5.1
`#buildSubtree(instance)` → accept plain `{ routes, middlewareMap, prefix }` (name-tagged). Boot path adapts; `flatten`/scope logic byte-unchanged — only the input boundary moves.
*Done when:* full suite green; boot path emits identical output through the new boundary.

### Phase 3 — Differential gate (zero-drift proof) — v5.1
Harness runs **both** paths (boot + AST) on the same controllers, asserts **byte-identical** `.routes.gen.ts`. Over framework + fixtures + consumer.
*Done when:* AST ≡ boot for every declarative controller; only `needsBoot` ctrls differ.

### Phase 4 — Flip to AST primary + boot fallback — v5.1
`generateRouteTypes` uses AST; falls back to the boot/ghost path **per controller** only when `routes` is non-declarative. Fallback also takes imports/middleware from AST (ghost reads only the dynamic `routes`).
*Done when:* `npm run gen` over framework + consumer uses AST for declarative ctrls; golden tsc gate + differential harness green.

### Phase 5 — Models / app-types via the same pass — v5.1  *(folds in P1j Phase 3)*
`appTypes.ts` detects `extends BaseModel` (heritage walk) + `static isBaseModel` from source instead of `await import()`-ing every model — zero model imports, zero Mongoose load. `getModel` / `appInfo.user` emission unchanged.
*Done when:* `npm run gen` does zero `import()` under `models/`; `appTypes.test.ts` output unchanged; a replaced consumer `User` still types `appInfo.user`.

### Phase 6 — Delete `importResolution.ts` — v5.1 (gated by Phase 3)
Remove `importResolution.ts` (+ test → relevant cases ported to `astExtract.test.ts`) and `MiddlewareRef.Class` / identity-matching from the AST + fallback paths. (Ghost/boot stay as the routes fallback.) Contingency: if the fallback can't cleanly source imports from AST, keep `importResolution` fallback-only and delete in v6 — decide at Phase 3.
*Done when:* `rg importResolution src/` is empty; full suite + golden gate green.

### Phase 7 — Drop the boot/ghost fallback — v6 (= P1j Phase 5 / [[static-middleware-cutover]])
Declarative-`routes`-only mandate; delete `ghostController.ts` + the app boot in `routeTypes.ts`. Breaking → v6.

## Files touched

| File | Phase | Change |
|---|---|---|
| `package.json` | 0/1 | add `oxc-parser` to **`dependencies`** (codegen runs in consumer projects; napi prebuilds) |
| `src/codegen/astExtract.ts` (+ `.test.ts`) | 1 | NEW — oxc extractor + tests |
| `src/controllers/index.ts` | 2 | `#buildSubtree` accepts extracted data; boot adapter |
| `src/codegen/routeTypes.ts` | 4, 7 | AST primary + fallback; (7) drop boot |
| `src/codegen/emit.ts` | 4, 6 | chain = binding names; drop `importResolution` use |
| `src/codegen/collectMetadata.ts` | 4, 6 | routes from extracted data; remove `MiddlewareRef.Class` |
| `src/codegen/appTypes.ts` | 5 | AST `BaseModel` detection; no `import()` |
| `src/modules/BaseModel.ts` | 5 | `static isBaseModel = true` (shared w/ P1j Ph3) |
| `src/codegen/*differential*.test.ts` | 3 | NEW — boot≡AST gate |
| `src/codegen/importResolution.ts` (+ test) | 6 | DELETE |
| `src/codegen/ghostController.ts` (+ test) | 7 (v6) | DELETE |
| `CHANGELOG.md` | each | per-phase entries |

## Out of scope
- Removing the boot/ghost fallback (v6, Phase 7).
- Incremental codegen cache + OpenAPI ([[codegen-incremental]] / P2a).
- Porting `flatten`/scope to Rust (reuse the JS resolver — see the doc).
- Config-type generation (already import-free value-shapes).

## Risks & rollback
- **Dynamic getters** → hybrid fallback (Phase 4); coverage measured in Phase 0.
- **`#buildSubtree` decoupling** (Phase 2) → full suite gate; pure boundary move.
- **oxc vs `tsc` syntax fidelity** → the Phase 3 differential gate over real TS is the proof.
- **Rollback**: Phases 1–3 additive; Phase 4 is a flag flip (revert = boot primary); deletes (6) last and gated.

## Done when (overall, <5 min)
`npm run gen` over the framework + a consumer: declarative controllers go through AST (no boot, no `models/` imports), golden tsc gate green, differential harness shows boot≡AST, `rg importResolution src/` empty, and consumer wall-clock beats the P1j target (cold <300 ms / warm <100 ms).
