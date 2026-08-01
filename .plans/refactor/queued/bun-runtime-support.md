# Bun runtime support (stable-fix-gated)

**Status**: ⏸ queued — activate immediately when Bun ships the fix in a stable release  
**Target**: an immediate v5.x patch after that stable Bun release; never v6 or post-v6  
**Depends on**: the first official stable Bun release containing
[`oven-sh/bun#32502`](https://github.com/oven-sh/bun/pull/32502)  
**Independent of**: P1q/P3/P4/P5 and the native `BunAdapter`; this phase uses Bun's Node
compatibility with the existing `ExpressAdapter`  
**Origin**: 2026-08-01 compatibility review. Bun 1.3.14 fails while importing the BSON version
resolved by Mongoose 9.9.1. Bun 1.4 canary (`1.4.0-canary.1+65c47c806`) imports that dependency
graph and passed a real MongoDB CRUD probe after the upstream `node:v8` fix.

## Goal

Make Bun a tested, documented production runtime for the existing v5 framework as soon as Bun
ships the upstream fix in stable. If Bun backports it to 1.3.x, use that release; otherwise use
1.4.0. Do not wait for another framework feature or release train. This is compatibility
certification and small portability fixes, not a new HTTP engine: applications keep their
controllers, middleware, Mongoose models and Express adapter.

## Release gate and support policy

1. Bun has published a stable release whose revision contains the BSON/Mongoose fix above. That
   exact version becomes the framework's minimum supported Bun version.
2. Current supported Mongoose and its naturally resolved MongoDB/BSON dependency graph import and
   perform real CRUD without a root `bson` override or Bun patch.
3. CI tests both the declared Bun floor and the latest stable Bun. A Bun patch regression blocks a
   framework release that claims that patch; canary remains informational, not the support floor.
4. Node >=24 remains supported. Bun support is an additional runtime path, not a Node replacement.

Do not ship the temporary `bson@7.2` override used to diagnose Bun 1.3.14. If the stable release
still needs it, keep this card queued and report the regression upstream instead of transferring a
runtime workaround to framework consumers.

## Implementation

- Cut the Bun-support framework patch as soon as the release gate and CI are green; it must not be
  bundled behind v5.3, v6, P3, P4, P5, or unrelated queued work.
- Add a Bun CI workflow. Install the repository's locked graph with `npm ci`, then execute the
  framework's runtime tests under Bun; this avoids adopting a second source-repository lockfile
  merely to certify a runtime.
- Add a separate packed-consumer smoke test that installs the generated npm tarball with Bun. It
  must import the public runtime surface, construct and boot `Server`, serve one request, exercise
  Mongoose create/read/update/delete against a real MongoDB service, and shut down cleanly.
- Run the existing compatible Vitest suite through Bun. Any excluded test must exercise an
  explicitly Node-only feature and be named in the support documentation; no blanket allow-failure
  job.
- Document the Bun floor and tested scope in `README.md`. The initial implementation runs through
  Bun's Node compatibility layer and `ExpressAdapter`; `cluster.js` remains a Node-only deployment
  entry unless its Bun behavior is separately proven.
- Add package metadata for the Bun floor only after verifying that npm and Bun interpret the
  combined Node/Bun engine declaration as alternative runtime constraints without false install
  failures.

## Files touched

- `.github/workflows/bun.yml` (new)
- `scripts/bun-packaging-smoke-test.sh` (new)
- `package.json`
- `README.md`

If a framework defect needs a source fix, add that exact source file and its colocated test to this
list before implementation. The release-gate work must not become an unbounded portability sweep.

## Out of scope

- Native `Bun.serve` integration or a `BunAdapter` (remains P5 adapter work).
- Deno support; it needs its own runtime/dependency audit and does not block Bun certification.
- Replacing Node types with Bun types, using Bun-only APIs in shared framework code, or dropping
  Node support.
- Promising compatibility with a Bun version older than the first fixed stable release, or
  carrying a transitive BSON pin.

## Done when

- A stable Bun release containing the fix is available and both floor/latest CI jobs are required
  and green.
- A clean Bun consumer installs the packed framework with no override, boots against MongoDB,
  passes HTTP + Mongoose CRUD, and exits cleanly.
- The compatible framework suite passes under Bun, all existing Node CI/packaging jobs remain
  green, and the README states the runtime floor, Express-compatibility implementation, and any
  explicitly Node-only entry points.
