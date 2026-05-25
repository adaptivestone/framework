# Prior art

Where each design choice came from. Consult when an open question reopens — chances are the trade-off is captured here.

## Hono (`honojs/hono`)

Production-grade techniques worth stealing or adapting for Node.

- [`src/router/smart-router/router.ts`](https://github.com/honojs/hono/blob/main/src/router/smart-router/router.ts) — lazy build + rebind: try `RegExpRouter` (single compiled regex, O(1)) first; fall back to `TrieRouter` if syntax conflicts arise; rebind `this.match` to the winning router after first request. Eliminates dispatch overhead.
- [`src/router/reg-exp-router/router.ts`](https://github.com/honojs/hono/blob/main/src/router/reg-exp-router/router.ts) — single-regex compile via Trie. O(1) match.
- [`src/compose.ts`](https://github.com/honojs/hono/blob/main/src/compose.ts) — recursive middleware dispatch with closure-captured index. No allocation per request.
- [`src/context.ts`](https://github.com/honojs/hono/blob/main/src/context.ts) — lazy getters: `c.req`, `c.var`, `c.res` not allocated until accessed. `Object.create(null)` for hot-path objects.
- [`src/utils/stream.ts`](https://github.com/honojs/hono/blob/main/src/utils/stream.ts) — Web Streams wrapper with `onAbort()` cleanup pattern.
- [`src/hono-base.ts`](https://github.com/honojs/hono/blob/main/src/hono-base.ts) — `app.request()` in-process test client (no HTTP socket).
- [`src/types.ts`](https://github.com/honojs/hono/blob/main/src/types.ts) — chainable type accumulation (`Hono<E, S, BasePath>`).
- [`src/validator/validator.ts`](https://github.com/honojs/hono/blob/main/src/validator/validator.ts) — validator middleware; `Input` generic flows from validator output to handler param.
- [`src/helper/factory/index.ts`](https://github.com/honojs/hono/blob/main/src/helper/factory/index.ts) — `createHandlers` for separated handler typing.

Local research clones: `~/Work/framework-ideas/hono` (outside this repo).

## TanStack Router (`TanStack/router`)

The codegen pattern.

- [`packages/router-plugin/src/vite.ts`](https://github.com/TanStack/router/blob/main/packages/router-plugin/src/vite.ts) — file-watcher Vite plugin.
- [`packages/router-generator/src/generator.ts`](https://github.com/TanStack/router/blob/main/packages/router-generator/src/generator.ts) — codegen entry; AST-parses route files with Babel.
- [`packages/react-router/src/fileRoute.ts`](https://github.com/TanStack/router/blob/main/packages/react-router/src/fileRoute.ts) — `createFileRoute` literal-string-constrained signature, the consumption side of the codegen.
- Generated output sample: `routeTree.gen.ts` files under `examples/`.

For: AST-based codegen architecture; module augmentation as the user-side API surface; per-file route convention.

## Mongoose pattern (this repo)

The starting point — the framework already has a great typed declarative pattern for models. The refactor extends the same shape to controllers and middlewares.

- `src/modules/BaseModel.ts:18-22` — `ExtractProperty` utility.
- `src/modules/BaseModel.ts:25-79` — `GetModelTypeFromClass` (the type machinery).
- `src/models/User.ts:33-76` — `static get modelSchema()` with `as const` (the user-facing surface).

The codegen `<MethodName>Request` aliases reuse `ExtractProperty` directly. (Note: the original plan called these `Request<M, P>` parameterized types; we tested and rejected that — see `decisions.md` → "Codegen architecture".)

## Fastify v5

The "Express replacement on Node" reference.

- [Official benchmarks](https://fastify.dev/benchmarks/) (Jan 2026): Fastify 46,664 vs Hono 36,694 vs Express 9,433 req/s.
- Pre-compiled handler chains, find-my-way router, fast-json-stringify integration.

## Encore.ts

Different point in the design space — Rust runtime with TS DX. Demonstrates that perf-critical paths can be native without losing TS ergonomics.

- [Rust runtime architecture](https://encore.dev/blog/rust-runtime).
- [9× Express benchmark](https://encore.dev/blog/event-loops).

Relevant if Phase 5+ ever justifies a native hot path.

## Standard Schema

The validator-interface foundation.

- [standardschema.dev](https://standardschema.dev/) — the spec.
- Implementations: Zod 3.23+/v4, Valibot 1+, ArkType, Effect Schema, TypeBox.
- `~standard.validate(input)` is the runtime contract; `~standard.types.output` is how we read inferred types.
- Adopted by tRPC, TanStack, Hono.

## OpenTelemetry HTTP semconv

The metrics/spans label conventions.

- [HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/).
- [HTTP metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/).
- Current stable: `http.request.method`, `http.route` (parameterized), `url.path`, `http.response.status_code`. `http.route` MUST NOT be set if framework can't supply it.

## Sentry + OTel

- [Sentry's OTel platform docs](https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/).
- Sentry Node SDK is now built on OTel; every framework-emitted span is automatically picked up. Per-request `Sentry.withIsolationScope()` is the canonical pattern for tag isolation.

## MCP TypeScript SDK

LLM/agent surface.

- [Official repo](https://github.com/modelcontextprotocol/typescript-sdk).
- [SDK docs](https://ts.sdk.modelcontextprotocol.io/).
- Tools registered via `server.registerTool(name, { description, inputSchema }, handler)`; accepts any Standard Schema. Streamable HTTP transport (2025-03-26 spec).

## Anthropic — Code Execution with MCP

- [Engineering post](https://www.anthropic.com/engineering/code-execution-with-mcp).
- 98.7% token reduction by exposing tools as a TypeScript module surface for "progressive disclosure." Foundation of the typed-client export pattern.

## Anthropic — Writing tools for agents

- [Engineering post](https://www.anthropic.com/engineering/writing-tools-for-agents).
- Namespacing rules, response_format conventions, error-as-instruction pattern, response size caps (default 25k tokens).

## Cloudflare — Code Mode

- [Blog post](https://blog.cloudflare.com/code-mode/).
- LLM-generated TypeScript executed in V8 isolates against framework RPC bindings. Reference for `app.toCodeModeBundle()`.

## Stainless — OpenAPI to MCP lessons

- [Blog post](https://www.stainless.com/blog/lessons-from-openapi-to-mcp-server-conversion).
- The 40-tool ceiling, Cursor's cap, accuracy degrades up to 85%. The three-meta-tool pattern (`list_endpoints`, `get_endpoint_schema`, `invoke_endpoint`) — the canonical workaround.

## `mcp-it/fastify`

- [Repo](https://github.com/AdirAmsalem/mcp-it).
- Closest precedent for "framework auto-discovers routes → MCP tools." Per-route `config.mcp: { name, description, hidden }` override pattern.

## AGENTS.md

- [agents.md](https://agents.md/) — Linux Foundation standard, supported by Claude Code/Cursor/Codex/Copilot/Windsurf.
- Anecdotal reports: verbose AGENTS.md files can reduce agent success rates and add inference cost (verify before citing in user-facing docs); the conservative posture stands regardless — keep ours minimal and factual.

## Node `diagnostics_channel`

- [Node docs](https://nodejs.org/api/diagnostics_channel.html).
- Stable since v18.13. Zero cost when no subscribers. The right tool for framework-owned extension hooks.

## `@opentelemetry/instrumentation-winston`

- [npm](https://www.npmjs.com/package/@opentelemetry/instrumentation-winston).
- Auto-injects `trace_id`/`span_id`/`trace_flags` into winston records. Optionally bridges winston → OTel Logs SDK via `@opentelemetry/winston-transport`.

## prom-client + cardinality

- [Repo](https://github.com/siimon/prom-client).
- [Games24x7 P99 10× writeup](https://medium.com/@Games24x7Tech/optimizing-prom-client-how-we-improved-p99-latencies-by-10x-in-node-js-c3c2f6c68297).
- Standard Prometheus exporter; cardinality is the #1 risk — strict label discipline (`http.request.method`, `http.route`, `http.response.status_code` only).

## Pyroscope (Grafana)

- [`@grafana/pyroscope-nodejs`](https://github.com/grafana/pyroscope-nodejs).
- [Docs](https://grafana.com/docs/pyroscope/latest/configure-client/language-sdks/nodejs/).
- pprof export, dynamic tag injection — the route-auto-tag hook is the killer feature.

## find-my-way

- [Repo](https://github.com/delvedor/find-my-way).
- Fastify's radix-tree router. Proven, no syntax limitations. Pragmatic Phase 2c choice.
- Radix-tree dispatch: lookup is O(URL length), not O(routes). Per-method tries (one per HTTP verb) make method dispatch O(1). Static > param (`:id`) > wildcard (`*`) priority falls out of the structure — no ordering bugs. Node-only.

## `URLPattern`

- [WHATWG spec](https://urlpattern.spec.whatwg.org/) · [MDN](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern) · [explainer](https://github.com/whatwg/urlpattern/blob/main/explainer.md).
- Web-standard URL matching primitive. Available in Workers, Deno, Bun, browsers, and Node ≥23.8. Pattern syntax based on `path-to-regexp`; matches across `protocol`/`hostname`/`pathname`/`search`/`hash` independently with named groups (`pattern.exec(url).pathname.groups.id`).
- **Spec is matcher-only.** No method dispatch, no priority rules, no indexing. The proposed `URLPatternList` is just a flat-list `.test()` convenience — same big-O as iterating yourself. Any router architecture (per-method buckets, static-prefix index) is on top.
- Per-match cost is regex execution, slower than radix walk. To stay fast at scale, layer it: (1) `Map<Method, ...>` per HTTP verb, (2) `Map<string, Handler>` exact-match fast path for routes with no `:`/`*`, (3) radix tree of static prefixes with `URLPattern`s at leaves — `URLPattern.exec` runs only on the 1-3 candidates in the bucket. Hono's `SmartRouter` is the reference for this layering (with `RegExpRouter` taking it further by merging all patterns into one regex).
- **Parse-time-only mode** (most aggressive): use `URLPattern` purely at registration to validate syntax, extract param names, and peel the static prefix — then **never call `.exec()` at request time**. Dispatch is pure radix tree + manual segment-by-segment param extraction. Trade: zero regex cost on the hot path and the user-facing pattern syntax stays the web standard, at the cost of reimplementing parameter extraction (encoding edge cases, regex-group params like `:id(\\d+)`, multi-component matching). Reasonable when the framework only ever exposes `pathname` patterns and rejects exotic syntax.
- Relevance: not P2c (find-my-way wins on Node-only throughput). Becomes the question in v6+/P5 when adapters target Workers/Deno/Bun where find-my-way isn't portable. Open Question #7 tracks the trade-off.

## `fast-json-stringify`

- [Repo](https://github.com/fastify/fast-json-stringify).
- Schema-compiled JSON serialization; ~2.4× small strings, ~1.6× small objects. Watch out for `additionalProperties` / large unions. Per-route opt-in.

## `undici`

- [Matteo Collina deep dive](https://gitnation.com/contents/deep-dive-into-undici).
- Direct `undici.request` + shared `Agent` is ~3× faster than `fetch`/`axios`/`got` for high-throughput cases.
