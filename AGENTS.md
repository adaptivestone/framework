# AGENTS.md

Guidance for AI agents (and humans in a hurry) working on `@adaptivestone/framework`.

## Check the plans first

All non-trivial work is tracked in `.plans/refactor/`. Status = directory:
`done/` shipped · `active/` in flight · `queued/` designed, not started · `later/` v6+ horizon.
`.plans/refactor/README.md` is the index and dependency map — it can lag the code, so verify its claims against the source before relying on them.

Before starting any task:

1. Read `.plans/refactor/README.md`.
2. Open every plan whose area overlaps the task (search the folder for the files/terms you are about to touch).
3. If a plan covers the task, follow its settled decisions — do not silently re-design them.
4. If your change conflicts with a queued/active plan, stop and flag the conflict instead of shipping a competing design.

Keep the plans in sync with the work:

- Finishing planned work = update the plan file, move it to the right status directory, and fix the README index in the same change.
- New non-trivial work gets a plan doc in `queued/` before implementation starts.

## Verification

Run before claiming anything is done:

- `npm test` — full suite (node:test)
- `npm run check` — biome lint + format
- `npm run check:types` — codegen + `tsc --noEmit`
- `npm run smoke` — packaging smoke test (pack → install into a scratch consumer)

## Conventions

- Do not commit or push. Leave changes in the working tree — a human reviews every diff and does their own git.
- Changelog entries go under `Unreleased` in `CHANGELOG.md`.
- Match the surrounding code style; `biome` is the arbiter. Compact JSDoc, no framework-internals talk in public-facing docs.
