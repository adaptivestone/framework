import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import SomeController from '../tests/fixtures/controllers/SomeController.ts';
import AbstractController from './AbstractController.ts';

describe('abstract controller methods', () => {
  it('can get routes', async () => {
    const controller = new AbstractController(appInstance, '');
    const childController = new SomeController(appInstance, '');

    const { routes } = controller;
    const { routes: childRoutes } = childController;

    assert.deepStrictEqual(routes, {});
    assert.notStrictEqual(childRoutes, undefined);
  });
});
