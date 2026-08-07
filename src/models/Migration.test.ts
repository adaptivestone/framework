import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import type { TMigration } from './Migration.ts';

describe('migration model', () => {
  it('migrationFile should be uniqe', async () => {
    let errorCode: number | undefined;
    const MigrationModel = appInstance.getModel(
      'Migration',
    ) as unknown as TMigration;

    if (!MigrationModel) {
      throw new Error('Migration model not found');
    }

    await MigrationModel.syncIndexes();
    await MigrationModel.create({
      migrationFile: 'a',
    });
    await MigrationModel.create({
      migrationFile: 'a',
    }).catch((e) => {
      errorCode = e.code;
    });

    assert.strictEqual(errorCode, 11000);
  });
});
