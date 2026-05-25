# P1h — Ship LLM-readable surface (Agent Skills + llms.txt)

**Status**: ⏳ in flight
**Depends on**: P1g (docs sweep — accuracy upstream feeds skill quality)
**Time**: ~1.5 days after P1g lands (split across docs additions, generator, validation, publish)
**Origin**: heavy LLM-assisted dev of the framework itself revealed the same need for framework *consumers* — fast, structured context. 2026-05-24 deep-dive surfaced the open Agent Skills standard (https://agentskills.io) backed by 40+ agents (Claude Code, Cursor, Copilot, Codex, …) plus the `skills.sh` registry (Vercel-Labs `skills` CLI) for cross-agent install.

## Goal

Ship an LLM-first context layer alongside the human docs. **Single source of truth** — generate the skill from `framework-documenation-github/docs/`, so docs stay authoritative and skill stays in sync automatically.

Two artifacts, smallest first:

1. **`llms.txt` at the doc root** — short hand-curated index per https://llmstxt.org/.
2. **Agent Skills package** — `framework-documenation-github/skills/adaptivestone-framework/` conforming to the open Agent Skills spec. One skill, multi-file progressive disclosure under `references/`.

## Why

- Open standard, multi-vendor. Skill works in Claude Code, Cursor, Copilot, Gemini CLI, OpenCode, Goose, and ~40 other agents without per-client adapters.
- `skills.sh` provides one-command install (`npx skills add <owner>/<repo>`) and a public discovery surface (telemetry-driven ranking, opt-out via `DISABLE_TELEMETRY=1`).
- Reusing `docs/` keeps LLM + human content in sync — no two-source maintenance.
- The framework's primary consumers already dogfood Claude Code; cross-agent reach is a free bonus.

## What lands

### Doc additions (`framework-documenation-github/docs/`)

The audit + new content benefit humans first. The skill picks them up for free.

- `docs/15-recipes.md` — step-by-step cookbook. Add a controller, add a route with body schema, add a middleware that injects `appInfo`, wire pagination, override a framework controller, test a controller with the framework's helpers.
- `docs/16-anti-patterns.md` — common mistakes + reasons. Don't hand-edit `.gen.ts`, don't `new` middlewares manually, don't mutate `req.body` to bypass validation, don't put state in `routes` getter, don't reach into raw Express where `req.appInfo.*` already exposes it.
- `docs/10-cli.md` — new section *When to run codegen* (decision matrix table).

### Generator (`framework-documenation-github/scripts/generate-skill.js`)

Sibling to the existing `generate-llm-context.js`. Walks `docs/`, writes:

```
framework-documenation-github/skills/
└── adaptivestone-framework/
    ├── SKILL.md                       # generated index + frontmatter
    └── references/
        ├── intro.md                   ← docs/01-intro.md
        ├── configs.md                 ← docs/02-configs.md
        ├── files-inheritance.md       ← docs/03-files-inheritance.md
        ├── base.md
        ├── models.md
        ├── controllers.md             ← docs/06-Controllers/01-intro.md
        ├── routes.md                  ← docs/06-Controllers/02-routes.md
        ├── middleware.md              ← docs/06-Controllers/03-middleware.md
        ├── logging.md
        ├── i18n.md
        ├── testing.md
        ├── cli.md
        ├── cache.md
        ├── email.md
        ├── deploy.md
        ├── helpers.md
        ├── recipes.md                 ← docs/15-recipes.md
        └── anti-patterns.md           ← docs/16-anti-patterns.md
```

Transform per source file (minimal): strip numeric prefix from filename, rewrite internal links (`02-routes.md` → `routes.md`), strip image refs (LLMs can't read), drop the controllers subdirectory level, preserve everything else.

`SKILL.md` is generated: frontmatter (name, description) + router list + always-apply rules inline (path syntax, Map keys, gen-file rules).

### Pipeline (`framework-documenation-github/package.json`)

```json
"scripts": {
  "generate-llm-context": "node scripts/generate-llm-context.js",
  "generate-skill": "node scripts/generate-skill.js",
  "validate-skill": "skills-ref validate skills/adaptivestone-framework",
  "build": "npm run generate-llm-context && npm run generate-skill && npm run validate-skill && docusaurus build"
}
```

`skills-ref` from https://github.com/agentskills/agentskills validates frontmatter + naming rules in CI.

## Spec compliance (https://agentskills.io/specification)

- `SKILL.md` body <500 lines / <5000 tokens (router + always-apply rules only; detail in `references/`)
- `name`: `adaptivestone-framework` — lowercase, hyphens, matches directory name
- `description`: 1–1024 chars, "what AND when" with framework keywords (`routes` getter, `AbstractController`, static middleware Map, Standard Schema, `npm run gen`, etc.)
- Reference files **one level deep** — `references/<file>.md`, no nesting
- Optional `license`, `metadata` set per spec

## Distribution

End-user install (one line, works across 40+ agents):

```bash
npx skills add adaptivestone/framework-documenation-github
```

Discovered by `skills.sh` once first installed (telemetry-driven indexing). README snippet for both `framework-github/README.md` and `framework-documenation-github/README.md`:

````markdown
## For AI assistants

Domain-knowledge skill for AI coding agents (Claude Code, Cursor, Copilot, …):

```bash
npx skills add adaptivestone/framework-documenation-github
```

After installing, your agent loads framework conventions on demand. Works with
any agent that supports the Agent Skills format — see https://agentskills.io.
````

## Out of scope

- Full MCP server with auth, deny-by-default — that's P2d.
- Per-agent custom skill formats — the open standard handles cross-agent.
- Static `version-awareness.md` / `conventions.md` / `style.md` pages — defer; surface from CHANGELOG, glossary, and style memory only when concrete gaps emerge from real usage.
- MCP-light read-only server — defer; bundle with P2d when that lands.

## Done when

- `docs/15-recipes.md` + `docs/16-anti-patterns.md` exist, render in Docusaurus, linked from `01-intro.md`
- `docs/10-cli.md` has the *When to run codegen* section
- `scripts/generate-skill.js` runs from `npm run build`; output committed at `skills/adaptivestone-framework/`
- `npm run validate-skill` green (skills-ref accepts the frontmatter)
- Local smoke test: `npx skills add ./skills/adaptivestone-framework -a claude-code` installs, `/skills` lists `adaptivestone-framework`
- Post-publish: `npx skills add adaptivestone/framework-documenation-github -a claude-code` works against a fresh checkout
- Auto-trigger smoke test: ask *"how do I write a controller in @adaptivestone/framework?"* in a fresh Claude Code session; skill activates and pulls `references/controllers.md` + `references/recipes.md`
- README install snippet added to framework + docs repos
- `llms.txt` at doc-repo root, linked from the docs landing page

## Trade-offs

- **Generator coupling**: docs-format changes can break the skill build. Mitigated by `skills-ref validate` in CI.
- **Skill drift**: hand-edits to `skills/` files get overwritten by next `npm run generate-skill`. Add a `> AUTOGENERATED — do not edit` header to each file.
- **Telemetry**: `skills` CLI sends anonymous install events for skills.sh ranking. Document opt-out (`DISABLE_TELEMETRY=1`) in the install snippet.
- **Repo name carries a typo** (`framework-documenation-github` — missing `t`). The install command will surface this publicly. Either fix the repo name (breaking for existing forks/clones), or accept it. Worth a separate decision.

## Notes

Previous version of this plan (npm-bundle distribution + Claude-Code-only) is superseded. Agent Skills is the open standard; `skills.sh` is the registry layer on top. The skill content lives in the docs repo, not the framework repo, because the docs are already the source of truth.

References:
- https://agentskills.io/specification — frontmatter, structure, token budget
- https://agentskills.io/skill-creation/quickstart — minimal worked example
- https://github.com/vercel-labs/skills — `skills` CLI source
- https://github.com/anthropics/skills — example skills from Anthropic
- https://llmstxt.org/ — `llms.txt` convention
