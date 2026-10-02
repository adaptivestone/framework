# Log redaction on Winston (P1z rule 5, early)

**Status**: ✅ implemented 2026-10-02; unreleased
**Release**: next minor `5.5.0` (additive, on by default)
**Origin**: consumer feedback — Sentry events were filtered with `beforeSend`, but nothing stopped
sensitive values from reaching the logs. Redaction was settled in
[P1z](../queued/logging-facade-and-pino.md) (rule 5) for the v6 Pino cutover; the maintainer chose to
ship that rule now on Winston.

## Decision

- `config/log.ts` `redact`: field names, matched case-insensitively at any depth. Default
  `['authorization', 'cookie', 'password', 'secret', 'token']` — the P1z v6 config default, so 5.5
  and v6 behave the same. An app array replaces it (keep the defaults); `[]` disables.
- `src/services/logging/redaction.ts`: `redactValue` copies plain objects/arrays with matching values
  replaced by `[REDACTED]` (cycles handled, inputs never mutated; Errors, Dates and class instances
  passed through); `createRedactFormat` applies it to every field of a log entry except `level`
  and `message`.
- Wired as a logger-level Winston format after `errors({ stack: true })`, so it runs before every
  transport: console, Sentry (whose extras/user/tags come from entry fields) and custom transports.
- Message text and Error messages/stacks are never rewritten (P1z rule 5).
- v6: the Winston format goes away with Winston; P1z's `LoggerRuntime` reuses `redactValue`, the
  same config key and these tests.

## Files

`src/services/logging/redaction.ts` (+ test), `src/config/log.ts`, `src/server.ts`, `CHANGELOG.md`,
`queued/logging-facade-and-pino.md`; docs repo `07-logging.md`.
