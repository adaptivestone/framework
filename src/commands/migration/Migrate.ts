import path from 'node:path';
import * as url from 'node:url';
import type { TLock } from '../../models/Lock.ts';
import type { TMigration } from '../../models/Migration.ts';
import AbstractCommand from '../../modules/AbstractCommand.ts';

class Migrate extends AbstractCommand {
  static get description() {
    return 'Run all pending migrations';
  }

  async run() {
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));

    const files = await this.getFilesPathWithInheritance(
      path.join(dirname, '/../../migrations'),
      this.app.foldersConfig.migrations,
    );
    const MigrationModel = this.app.getModel(
      'Migration',
    ) as unknown as TMigration;
    const LockModel = this.app.getModel('Lock') as unknown as TLock;

    // Migrations run under the CLI, where mongoose `autoIndex` is disabled, so
    // the indexes these two models rely on are not built implicitly. Create them
    // up front: the Lock TTL reaper (`expiredAt`) and — as the backstop behind
    // the advisory lock — the `migrationFile` uniqueness that stops a stolen-lock
    // double-deploy from journaling the same migration twice. `createIndexes` is
    // idempotent and only adds missing indexes (it never drops).
    await Promise.all([
      LockModel.createIndexes(),
      MigrationModel.createIndexes(),
    ]);

    // Serialize concurrent deploys: two instances must not run migrations twice.
    // The lock is advisory with a 600s (10 min) TTL — a run that exceeds it can
    // have the lock stolen by a parallel deploy mid-run. Bump this if real
    // migrations approach that runtime.
    const gotLock = await LockModel.acquireLock('migrations', 600);
    if (!gotLock) {
      // Lock contention is a successful skip, not a failure: another instance
      // is running the migrations, so this replica returns true to exit 0.
      this.logger?.warn('Another migration run holds the lock — skipping');
      return true;
    }

    try {
      // Pending = files not yet recorded as applied (set difference). Comparing
      // against the *set* of applied filenames — not the timestamp of the most
      // recent one — means a branch-merged migration with an older timestamp is
      // still run instead of silently skipped. Order by filename timestamp.
      const applied = new Set(await MigrationModel.distinct('migrationFile'));

      // Discovery is recursive, so a migration can arrive as a subfolder-relative
      // path (`2024/1699…_x.ts`). Order by the numeric timestamp prefix of the
      // *basename* (strip directory segments), not the whole path.
      const pending = files
        .filter((f) => !applied.has(f.file))
        .map((f) => {
          const prefix = /^(\d+)_/.exec(path.basename(f.file));
          return { ...f, order: prefix ? Number(prefix[1]) : NaN };
        });

      // A pending migration whose basename is not `<timestamp>_name` has no
      // defined position — running migrations in an undefined order against prod
      // is worse than refusing. Fail loudly (log + non-zero exit) BEFORE running
      // anything, rather than let a NaN comparator silently mis-sort the rest.
      const malformed = pending.filter((f) => Number.isNaN(f.order));
      if (malformed.length > 0) {
        this.logger?.error(
          `Refusing to run migrations — these files are not named <timestamp>_name: ${malformed
            .map((f) => f.file)
            .join(', ')}`,
        );
        return false;
      }

      // Ties (same timestamp) break on the full path so the order is total and
      // deterministic even across subfolders.
      pending.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));

      // NOTE: `up()` and the journal write below are NOT atomic — no transaction
      // wraps them. If the process dies (or the lock is stolen after its TTL)
      // between a migration's side effects landing and its record being written,
      // that migration re-runs on the next deploy. Each `up()` MUST therefore be
      // idempotent (guard against re-application).
      for (const migration of pending) {
        this.logger?.info(`=== Start migration ${migration.file} ===`);
        const { default: MigrationCommand } = await import(migration.path);
        const migrationCommand = new MigrationCommand(this.app);
        await migrationCommand.up();
        // Run-then-record: a failed migration must not be journaled as applied.
        await MigrationModel.create({
          migrationFile: migration.file,
        });
      }

      this.logger?.info(
        `=== Migration Finished. Migrated ${pending.length} files ===`,
      );
      return true;
    } finally {
      await LockModel.releaseLock('migrations');
    }
  }
}

export default Migrate;
