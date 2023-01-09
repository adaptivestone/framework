const request = require('supertest');

describe('home', () => {
  it('can open home have', async () => {
    expect.assertions(1);
    const { status } = await request(global.server.app.httpServer.express).get(
      '/',
    );
    expect(status).toBe(200);
  });
});
