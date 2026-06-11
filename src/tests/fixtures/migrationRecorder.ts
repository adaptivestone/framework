// Shared recorder for the migration-runner test. Each fixture migration's
// `up()` pushes its filename here, so the test can assert exactly which
// migrations executed (and in what order) — not just which got journaled.
// Lowercase filename + outside the migrations fixture dir so the file scanner
// never treats it as a migration.
export const migrationRunLog: string[] = [];
