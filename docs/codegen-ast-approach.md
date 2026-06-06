# Codegen via AST extraction (design note)

Status: **proposal / not implemented.** Target: v6-scale refactor of the route-type
codegen front-end. The current boot-based codegen works and is fully tested; this
documents a faster, leaner alternative and its trade-offs so the decision is recorded.

## TL;DR

Replace "boot the app and reflect" with "parse the controller source (oxc), extract
the declarative `routes` / `middleware` / imports, and feed that into the framework's
**existing** `RouteRegistry.flatten()` to compute the middleware chain." Emit per-route
types from binding **names** + the AST's import map.

This drops the app boot, the ghost controller, and all of `importResolution.ts`, **without**
introducing a parallel routing matcher (it reuses the real one) and **without** changing
the authoring API.

## Why codegen exists at all

Handlers want precise `req` types: `appInfo.user` (and other middleware `provides`),
`appInfo.request` / `query` (route schemas), `params` (path). Of these, only the
**middleware chain per route** needs information that isn't in a single controller's
type — it's computed by the runtime route tree (scope keys, `/{*splat}`, method
prefixes, `extends` inheritance, root-mount bleed). TypeScript can't run that, so a
generator bridges it into types.

## Current approach (boot + reflect)

`generateRouteTypes` boots the app into an inspectable state, registers each controller
via a constructor-less **ghost**, builds the real `RouteRegistry`, and walks
`flatten()` so the resolved chains exactly match runtime. Then `emit` reconstructs each
middleware's import path/binding from the controller source (`importResolution.ts`) and
writes `<File>.routes.gen.ts`.

Pain points:
- **`importResolution.ts` (~385 lines)** reverse-engineers import paths + bindings,
  because the registry hands codegen live **class objects**, and a JS class carries no
  source path. Source of bug 1b (binding ≠ class name), the bare-package-ancestor gap,
  and the cross-directory rebasing bug.
- **Boot cost + side effects** — needs the ghost controller to avoid running constructors.

## The AST approach (proposed)

```ts
// 1. Parse with oxc's JS/napi bindings — no boot, no ghost, ms-fast.
import { parseSync } from 'oxc-parser';
const ast = parseSync(file, src);

// 2. Extract DECLARATIVELY from the AST:
//      routes:     { post: { '/login': { handler: 'postLogin', hasRequest: true } } }
//      middleware: [['/{*splat}', ['GetUserByToken', 'Auth']]]   // local binding NAMES
//      imports:    { GetUserByToken: { specifier: '…', kind: 'default' },
//                    AuthMiddleware: { specifier: '…', kind: 'named', orig: 'Auth' } }
//      extends:    'AbstractController' (+ its import) → recurse into that file

// 3. Reuse the REAL resolver. The routing logic (attachMiddlewares, scope keys,
//    splat, inheritance, bleed, flatten) treats middleware as OPAQUE entries — it
//    routes them by scope and never calls the class. So feed it name-tagged entries
//    and get the same chain order/scoping with ZERO drift:
const chains = flatten(buildSubtreeFromExtracted(extracted));

// 4. Emit: chain entries are binding NAMES; imports come straight from the AST map.
//    No importResolution, no identity matching, no boot, no ghost.
```

### What it removes

- The app boot in `routeTypes` and `ghostController.ts`.
- `importResolution.ts` entirely (the AST gives `binding → specifier` directly; the
  chain is binding names, so there is no class→path/binding reconstruction).
- The `MiddlewareRef.Class` carrier and the identity-matching machinery.

### What it keeps

- `RouteRegistry` + `flatten()` + the scope/inheritance/bleed logic — **reused**, so
  codegen and runtime can't disagree (no parallel matcher).
- `emit`'s rendering (`renderShape`, content-type unions, params, schema `InferOutput`).
- The config/model `genTypes.d.ts` generator (`appTypes.ts`) — orthogonal.

### Required refactor

Today `#buildSubtree(instance)` reads `instance.routes` / `instance.constructor.middleware`
/ `instance.getHttpPath()`. Decouple it to accept **plain extracted data**
(`{ routes, middlewareMap, prefix }` with name-tagged middleware entries), so both the
boot path and the AST path feed the same scope/flatten logic. The flatten/scope code is
unchanged — only its input boundary moves.

## Import aliasing — handled, and better than today

The AST approach keys everything on the **local binding** the source uses, read directly
from the import node — it never deals with the class. So the binding-vs-class-name problem
(bug 1b, and the reason `importResolution` is complex) simply doesn't arise.

| Source | AST records | Emitted in `.gen.ts` |
| --- | --- | --- |
| `import Auth from './Auth.js'` | binding `Auth`, default | `import type Auth from './Auth.js'`; `typeof Auth` |
| `import AuthMiddleware from './Auth.js'` (renamed default) | binding `AuthMiddleware`, default | `import type AuthMiddleware from './Auth.js'`; `typeof AuthMiddleware` |
| `import { Auth } from './auth.js'` | binding `Auth`, named | `import type { Auth } from './auth.js'`; `typeof Auth` |
| `import { Auth as AuthMiddleware } from './auth.js'` | binding `AuthMiddleware`, named, orig `Auth` | `import type { Auth as AuthMiddleware } from './auth.js'`; `typeof AuthMiddleware` |

The middleware `Map` references the local binding (e.g. `[AuthMiddleware]`), the import node
declares that same binding, and emit reproduces the exact import form (default vs named +
alias). Everything is consistent because it all comes from one source of truth: the binding.

(Note: `import Auth as AuthMiddleware` without braces is not valid JS — a renamed default
is `import AuthMiddleware from …`, an alias is `{ Auth as AuthMiddleware }`. Both are
supported.)

## The one real constraint

AST extraction only works when `routes` / `middleware` are **literal structures**
(`return { … }` / `new Map([ … ])`). *Values* may be expressions — `request: defineSchema(...)`
is fine, since codegen reads only the keys, the handler name, and "is `request` present",
never evaluating the expression. What breaks is a getter that *builds* the object
dynamically (loops, conditionals, spreads, computed keys). For those, **fall back to boot**
for that controller — a clean hybrid. This aligns with the existing direction (ghost-only /
declarative controllers in v6).

Edge case: namespace-member middleware references (`import * as mw` then `mw.Auth` in the
Map) → fall back to boot, or document as unsupported.

## Why NOT Rust / swc / oxc-for-types

- swc and oxc are **parsers** (syntax + scope/semantics), not TypeScript type-checkers.
  They cannot infer `InferOutput<schema>` or resolve `provides`. Only `tsc` / `tsgo` do.
- Codegen never *resolves* types anyway — it **emits type expressions**
  (`StandardSchemaV1.InferOutput<…>`, `typeof X`) that the consumer's `tsc` evaluates.
  So there is nothing to "grab."
- oxc's speed is available from Node via its napi bindings — no Rust port needed. Porting
  the resolver to Rust would re-create the parallel-matcher/drift problem in a second
  language for no benefit.

## When to do this

Not a beta task — it's a v6-scale rewrite of the codegen front-end. The current boot
approach is correct and justified while controllers may have dynamic getters. Decide via
a prototype:

1. Build oxc-extract → `flatten()` for a few real controllers (framework `Auth`/`Home`
   + a couple of consumer controllers).
2. Measure parse time vs current boot time.
3. Confirm declarative extraction covers the real controllers (e.g. `Auth`'s inline
   `defineSchema(...)`), and count how many need the boot fallback.

If it's meaningfully faster and the fallback set is small, it's a strong v6 refactor that
deletes boot + ghost + `importResolution`. If controllers lean on dynamic route-building,
the boot approach stays.
