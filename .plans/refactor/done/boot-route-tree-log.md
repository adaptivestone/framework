# P1e — Boot-time route tree log

**Status**: ✅ shipped — `formatRouteTree` in `src/services/http/routing/formatTree.ts`, called from `server.ts` at `verbose` level after controllers initialize. (Landed in `services/http/routing/`, not the `src/codegen/routeTreeLog.ts` this doc originally proposed.)
**Depends on**: P1b (RouteRegistry shipped)
**Time**: ~½ day
**Origin**: noticed missing during 2026-05-10 dogfooding against tht-server — the old `AbstractController` constructor logged a per-controller routes/middleware table at boot; the step-3 cutover dropped it.

## Goal

After `cm.initControllers()` finishes, walk the registry tree once and emit a single tree-shaped log showing every mounted route, its handler method name, and its accumulated middleware chain. Replaces the old flat per-controller table with a single project-wide tree, walked from `RouteRegistry` (single source of truth — same one the runtime walks).

## Why

- **DX regression we already paid for**: old behavior was useful; we dropped it during the cutover and only noticed when the user pointed it out.
- **Better than the old format**: the old per-controller table didn't show cross-controller middleware bleed (a `/`-mounted controller's `'/{*splat}'` mw appearing on every other controller's chain at runtime). A tree view from the registry shows exactly what runs where.
- **One walk, project-wide**: matches the registry's single-source-of-truth design. No per-controller bookkeeping.

## Output shape (sketch)

```
Routes (registered at 2026-05-10T22:39:16Z):
/
├── (mw: GetUserByToken)
├── auth/
│   ├── (mw: GetUserByToken, RateLimiter)
│   ├── login
│   │   └── POST → postLogin  [request: schema]
│   ├── register
│   │   └── POST → postRegister  [request: schema]
│   ├── logout
│   │   └── POST → postLogout
│   └── me
│       └── GET → getMe
├── webhook1c/
│   ├── 1c
│   │   └── POST → handleWebhook  [request: schema]  (auth disabled — Map [] override)
│   └── 1c/verify
│       └── POST → verify
└── v1/
    └── ymlexport
        └── GET → getYml  [mw: ApiLimiter]

55 routes registered. (28 controllers, 11 with codegen output, 17 .js / external.)
```

Format details TBD — but the shape is:
- Indented tree following the registry structure
- Node-level middlewares shown in `(mw: ...)` immediately under the node line
- Method entries show `METHOD → handlerName` plus `[request:]`, `[query:]`, route-level `[mw:]` tags
- Footer with totals

## Implementation

- New file `src/codegen/routeTreeLog.ts` — pure function `formatRouteTree(registry: RouteRegistry): string`. Walks tree, produces text. Trivially testable.
- Called from `server.ts` right after `cm.initControllers()`: `app.logger.info(formatRouteTree(app.httpServer.routeRegistry))`. Or wrap in `info` so it's filterable.
- Log level: `info` (visible by default; users on `warn` won't see it). Or behind a config flag (`http.logRoutes: boolean`) so prod can opt out.

## Out of scope

- HTTP timing / per-route metrics (P2b observability)
- OpenAPI emission (P2a)
- Live route hot-reload notification

## Done when

- Server boot in any project (framework, tht, etc.) prints a tree summary of all registered routes within 1 line of "App started and listening on port N".
- Format is readable on a 100-char terminal (truncate or break long middleware chains).
- One test (`formatRouteTree(syntheticRegistry)` → snapshot match) lives next to the formatter.
- No regression in framework's 219+ existing tests.

## Trade-offs

- Adds startup output for projects that prefer quiet boots. Mitigation: gate on a config flag if loud-by-default complaints come in.
- Slightly bigger startup time for projects with hundreds of routes (single tree walk, O(n) — negligible vs HTTP-server start cost).
