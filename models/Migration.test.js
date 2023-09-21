import { describe, it, expect } from 'vitest';

describe('migration model', () => {
  it('migrationFile should be uniqe', async () => {
    expect.assertions(1);
    let errorCode;
    const MigrationModel = global.server.app.getModel('Migration');
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
