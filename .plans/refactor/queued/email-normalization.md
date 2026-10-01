# Case-insensitive user email

**Source**: code review of 2026-09-23 (not kept in the repository), finding #6.
**Status**: needs a decision before implementation — behavior change plus data
migration.

## Problem

`User.email` is stored and matched exactly. `Foo@x.com` and `foo@x.com`
register as two accounts; login, recovery and verification need the casing
used at sign-up, and a recovery request with other casing silently sends
nothing (the response is a uniform 200).

## Options

1. **Normalize on write and lookup** — trim + lowercase in registration, the
   `getUserBy*` statics and `CreateUser`; schema `lowercase: true, trim: true`.
   Simple queries and index; changes stored values.
2. **Case-insensitive collation** — unique index with
   `{ locale: 'en', strength: 2 }` and the same collation on every email query.
   Stored casing kept; every custom query must remember the collation.

Recommendation: option 1 (one rule, no per-query collation).

## Migration

- A command that reports accounts whose emails collide after normalization —
  these must be merged or renamed by the application before the unique index
  can be rebuilt; never auto-merge.
- A migration that lowercases stored emails once the report is clean.
- Release as a minor with a CHANGELOG behavior-change entry, or hold for v6.

## Open questions

- Minor release or v6?
- Normalize the local part too (practically universal, not strictly RFC 5321)?
- Does a project `User` replacement inherit the normalization automatically?

## Files (planned)

`src/models/User.ts`, `src/models/User.test.ts`, `src/controllers/Auth.ts`,
`src/controllers/Auth.test.ts`, `src/commands/CreateUser.ts`, a new report
command and migration, `CHANGELOG.md`, documentation auth chapter.

## Out of scope

Unicode/IDN normalization of domains; `UserOld` (removed in v6).

## Done when

Mixed-case registration, login, recovery and verification resolve to one
account; the collision report and migration are tested against a seeded
database; the five gates pass.
