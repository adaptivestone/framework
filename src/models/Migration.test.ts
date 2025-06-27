import { describe, expect, it } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import type { TMigration } from './Migration.ts';

describe('migration model', () => {
  it('migrationFile should be uniqe', async () => {
    expect.assertions(1);

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

    expect(errorCode).toBe(11000);
  });
});
