import { describe, expect, it } from 'vitest';
import SomeController from '../controllers/test/SomeController.ts';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractController from './AbstractController.ts';

describe('abstract controller methods', () => {
  it('can get routes', async () => {
    expect.assertions(2);

    const controller = new AbstractController(appInstance, '');
    const childController = new SomeController(appInstance, '');

    const { routes } = controller;
    const { routes: childRoutes } = childController;

    expect(routes).toStrictEqual({});
    expect(childRoutes).toBeDefined();
  });
});
