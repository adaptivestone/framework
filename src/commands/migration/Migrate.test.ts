import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appInstance } from '../../helpers/appInstance.ts';
import type { TLock } from '../../models/Lock.ts';
import type { TMigration } from '../../models/Migration.ts';
import { migrationRunLog } from '../../tests/fixtures/migrationRecorder.ts';
import Migrate from './Migrate.ts';

const fixtureMigrations = fileURLToPath(
  new URL('../../tests/fixtures/migrations/', import.meta.url),
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
