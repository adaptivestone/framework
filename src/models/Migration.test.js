import { describe, it, expect } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';

describe('migration model', () => {
  it('migrationFile should be uniqe', async () => {
    expect.assertions(1);

    let errorCode;
    const MigrationModel = appInstance.getModel('Migration');
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
