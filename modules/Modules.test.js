const SomeController = require('../controllers/test/SomeController');
const AbstractController = require('./AbstractController');

describe('abstract controller methods', () => {
  it('can get routes', async () => {
    expect.assertions(2);

    const controller = new AbstractController(global.server.app);
    const childController = new SomeController(global.server.app);

    const { routes } = controller;
    const { routes: childRoutes } = childController;

    expect(routes).toStrictEqual({});
    expect(childRoutes).toBeDefined();
  });
});
