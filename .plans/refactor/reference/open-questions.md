# Open questions

12 unresolved trade-offs. Pick one and decide before its affected phase starts.

1. ~~**`defineMiddleware` helper.**~~
   *Resolved 2026-05-09 — rejected for v5*: the class form is already the convention; a parallel function-style API saves only ~5-10 lines for trivial middlewares while requiring users to choose between two shapes and forcing codegen to handle both. The original architectural argument (Pipeline needing a new middleware shape) doesn't apply since `(req, res, next)` stays in v5; `next()` removal is a v6 concern. Revisit alongside the v6 middleware-shape change.

2. **Multipart strategy for Phase 3.** `formidable` is Express-coupled. Swap to `busboy` (cleaner, transport-neutral) or keep formidable behind the adapter (less change, more glue)?
   *Decision lean*: defer; investigate during P3.

3. ~~**Generator parser.** TS compiler API vs. `oxc-parser`?~~
   *Resolved 2026-05-06*: chose **runtime introspection** over AST entirely. Boot framework, walk `cm.controllers`, extract metadata from already-compiled Express routers. See `decisions.md` → "Codegen architecture". If dev-loop performance becomes painful later, an AST fast-path is an additive optimization, not a replacement.

4. **Test-app fetch shape.** `app.fetch('POST', '/path', { body, headers })` (custom) vs. `app.fetch(new Request(...))` (Web Fetch)?
   *Decision lean*: ship the Web Fetch signature even in P2 — same surface that becomes universal in P5; tests written today won't have to change.

5. **Span attribute conventions.** Which OTel HTTP semconv version to track?
   *Decision lean*: current stable (`http.request.method`, `http.route`, `url.path`, `http.response.status_code`); track the semconv repo for renames.

6. **Mongoose OTel — auto vs. manual instrumentation.** `@opentelemetry/instrumentation-mongoose` auto-instruments globally; alternative is per-model wrapping.
   *Decision lean*: auto-instrumentation, opt-out per model only if needed.

7. **Router for P2c (and the P5 portable-runtime fork).** Three options:
   - **find-my-way** — radix tree, fastest on Node, no syntax caveats. Node-only.
   - **Hono-style `SmartRouter`** — `RegExpRouter` (single compiled regex) with `TrieRouter` fallback. Portable; high build complexity.
   - **`URLPattern` + custom dispatcher** — web standard (Workers/Deno/Bun/Node ≥23.8). Slower per-match unless wrapped in per-method buckets + static-Map fast path + radix-of-prefixes (with `URLPattern.exec` only at the leaves). See `prior-art.md` → URLPattern.
   - **`URLPattern` parse-time-only** — same standard syntax exposed to users, but `URLPattern` is called only at registration (validate syntax, extract param names, peel static prefix). Hot path is pure radix + manual param extraction; `.exec()` never runs per request. Maximum speed; cost is reimplementing param extraction and rejecting exotic pattern features.
   *Decision lean*: ship find-my-way for P2c (Node-only matters today). Re-open the question in P5 when adapters target portable runtimes — at that point `URLPattern` becomes the natural matcher and the layered dispatcher becomes the build.

8. **`fast-json-stringify` opt-in vs. opt-out.** Opt-in via per-route `response` schema (safer) vs. opt-out (auto-fast)?
   *Decision lean*: opt-in with a doc warning; auto-compilation is a footgun on schemas with `additionalProperties` or large nested unions.

9. **MCP transport default.** `stdio` (local-only, simpler) vs. `http` (network, broader)?
    *Decision lean*: support both; default `stdio` for `framework mcp serve` CLI, but expose `http` mount via `app.use('/mcp', mcpHttpHandler)`.

10. **Code-mode bundle vs. typed client.** Anthropic's pattern emits per-tool `.ts` files; Cloudflare's emits an RPC bundle. Both?
    *Decision lean*: ship both behind `app.toCodeModeBundle({ shape: 'files' | 'rpc' })`; default `'rpc'`, switch to `'files'` when route count exceeds N.

11. **Edge story when mongoose can't run.** Cloudflare Containers (real Node, mongoose works) vs. Drizzle as a sibling ORM for true Workers/edge?
    *Decision lean*: P5+; defer until actual user demand. Containers are the safer first stop.

12. **Diagnostics_channel ownership.** Public API (semver-stable) or internal (subject to change)?
    *Decision lean*: public. APM vendors and user observability code depend on stable shapes. Document in `docs/diagnostics-channels.md`; treat changes as breaking.

13. ~~**Cross-controller middleware composition in codegen.**~~
    *Resolved 2026-05-09*: superseded by the tree-based `RouteRegistry` design. Cross-controller composition is a tree-walk semantic — middleware accumulation reads by walking the registry, no source-file scanning. The implicit-inheritance gap is closed by construction (codegen and runtime read from the same tree). See `decisions.md` → "Routing architecture (P1b, resolved)".

## Process

When you decide one, move it to `decisions.md` with a short rationale and remove it here.
