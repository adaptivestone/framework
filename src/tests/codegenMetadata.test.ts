import { describe, expect, it } from 'vitest';
import { extractControllerMeta } from '../codegen/collectMetadata.ts';
import type AbstractController from '../modules/AbstractController.ts';
import { serverInstance } from './testHelpers.ts';

describe('codegen.collectMetadata', () => {
  describe('extractControllerMeta', () => {
    const getController = (name: string): AbstractController => {
      const cm = serverInstance.app.controllerManager;
      if (!cm) {
        throw new Error('No controllerManager on test server');
      }
      const found = Object.values(cm.controllers).find(
        (c) => c.constructor.name === name,
      );
      if (!found) {
        throw new Error(`No controller named ${name} on test server`);
      }
      return found;
    };

    it('extracts Auth metadata: 7 routes, all wired to handler methods', () => {
      const meta = extractControllerMeta(getController('Auth'));

      expect(meta.className).toBe('Auth');
      expect(meta.urlPrefix).toBe('/auth');
      expect(meta.routes).toHaveLength(7);

      const handlerNames = meta.routes.map((r) => r.handlerName).sort();
      expect(handlerNames).toEqual([
        'postLogin',
        'postLogout',
        'postRegister',
        'recoverPassword',
        'sendPasswordRecoveryEmail',
        'sendVerification',
        'verifyUser',
      ]);
    });

    it('distinguishes routes with schemas from bare-method-ref routes', () => {
      const meta = extractControllerMeta(getController('Auth'));
      const byHandler = Object.fromEntries(
        meta.routes.map((r) => [r.handlerName, r]),
      );

      expect(byHandler.postLogin?.hasSchema).toBe(true);
      expect(byHandler.postRegister?.hasSchema).toBe(true);
      // Bare method refs in `routes` getter (`'/logout': this.postLogout`)
      expect(byHandler.postLogout?.hasSchema).toBe(false);
      expect(byHandler.verifyUser?.hasSchema).toBe(false);
    });
  });
});
