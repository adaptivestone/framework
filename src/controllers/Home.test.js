import { describe, it, expect } from 'vitest';

describe('home', () => {
  it('can open home have', async () => {
    expect.assertions(1);

    const { status } = await fetch(global.server.testingGetUrl('/')).catch(
      () => ({ status: 500 }),
    );

    expect(status).toBe(200);
  });
});
