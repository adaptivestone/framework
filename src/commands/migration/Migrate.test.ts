import { fileURLToPath } from 'node:url';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { appInstance } from '../../helpers/appInstance.ts';
import type { TLock } from '../../models/Lock.ts';
import type { TMigration } from '../../models/Migration.ts';
import { migrationRunLog } from '../../tests/fixtures/migrationRecorder.ts';
import Migrate from './Migrate.ts';

const fixtureMigrations = fileURLToPath(
  new URL('../../tests/fixtures/migrations/', import.meta.url),
);
// Subfolder-organized migrations: `2024/2000_x.ts` must order by its basename
// timestamp (between 1000 and 3000), not by the folder-relative path.
const fixtureOrdering = fileURLToPath(
  new URL('../../tests/fixtures/migrationsOrdering/', import.meta.url),
);
// Holds a hand-added `AddIndex.ts` with no `<timestamp>_` prefix alongside a
// valid migration — the whole run must refuse before executing either.
const fixtureMalformed = fileURLToPath(
  new URL('../../tests/fixtures/migrationsMalformed/', import.meta.url),
);

describe('Migrate command (doc 15)', () => {
  let Migration: TMigration;
  let Lock: TLock;
  let originalMigrationsFolder: string;

  beforeAll(() => {
    Migration = appInstance.getModel('Migration') as unknown as TMigration;
    Lock = appInstance.getModel('Lock') as unknown as TLock;
    originalMigrationsFolder = appInstance.foldersConfig.migrations;
    appInstance.foldersConfig.migrations = fixtureMigrations;
  });

  afterAll(() => {
    appInstance.foldersConfig.migrations = originalMigrationsFolder;
  });

  beforeEach(async () => {
    migrationRunLog.length = 0;
    await Migration.deleteMany({});
    await Lock.deleteMany({ _id: 'migrations' });
  });

  const runMigrate = () => new Migrate(appInstance, {}, {}).run();

  // Point discovery at a specific fixture folder for one run, then restore, so
  // the ordering/validation fixtures don't leak into the other tests.
  const runMigrateFrom = async (folder: string) => {
    const previous = appInstance.foldersConfig.migrations;
    appInstance.foldersConfig.migrations = folder;
    try {
      return await runMigrate();
    } finally {
      appInstance.foldersConfig.migrations = previous;
    }
  };

  it('runs a branch-merged migration whose timestamp predates the last applied one', async () => {
    // `200_b` was applied on main; `100_a` merges in later with an OLDER stamp.
    await Migration.create({ migrationFile: '200_b.ts' });

    const result = await runMigrate();

    expect(result).toBe(true);
    expect(migrationRunLog).toEqual(['100_a.ts']); // ran, despite older stamp
    const applied = await Migration.distinct('migrationFile');
    expect(applied.sort()).toEqual(['100_a.ts', '200_b.ts']);
  });

  it('runs nothing when every migration is already applied', async () => {
    await Migration.create({ migrationFile: '100_a.ts' });
    await Migration.create({ migrationFile: '200_b.ts' });

    await runMigrate();

    expect(migrationRunLog).toEqual([]);
  });

  it('runs all pending migrations in filename-timestamp order', async () => {
    await runMigrate();

    expect(migrationRunLog).toEqual(['100_a.ts', '200_b.ts']);
  });

  it('orders a subfolder migration by its basename timestamp, not its path', async () => {
    // Discovery is recursive, so `2024/2000_x.ts` arrives as a folder-relative
    // path. Ordering by the basename prefix must slot it between 1000 and 3000.
    const result = await runMigrateFrom(fixtureOrdering);

    expect(result).toBe(true);
    expect(migrationRunLog).toEqual(['1000_a.ts', '2000_x.ts', '3000_b.ts']);
  });

  it('refuses the whole run when a pending migration name has no timestamp prefix', async () => {
    const migrate = new Migrate(appInstance, {}, {});
    const errorSpy = vi
      .spyOn(migrate.logger, 'error')
      .mockImplementation(() => migrate.logger);
    const previous = appInstance.foldersConfig.migrations;
    appInstance.foldersConfig.migrations = fixtureMalformed;

    let result: boolean;
    try {
      result = await migrate.run();
    } finally {
      appInstance.foldersConfig.migrations = previous;
    }

    expect(result).toBe(false);
    // Nothing runs — not even the well-named sibling — and nothing is journaled.
    expect(migrationRunLog).toEqual([]);
    expect(await Migration.distinct('migrationFile')).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('AddIndex.ts');
  });

  it('skips (returns true) when another run holds the migrations lock', async () => {
    // Lock contention is not a failure: the other instance is doing the work,
    // so the losing replica must exit successfully rather than fail its deploy.
    await Lock.acquireLock('migrations', 600);

    const result = await runMigrate();

    expect(result).toBe(true);
    expect(migrationRunLog).toEqual([]);

    await Lock.releaseLock('migrations');
  });
});
