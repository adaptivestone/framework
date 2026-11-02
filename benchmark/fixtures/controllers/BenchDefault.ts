import type { Response } from 'express';
import AbstractController from '../../../src/modules/AbstractController.ts';

/**
 * Keeps the framework's default controller middleware (`GetUserByToken`,
 * `Auth`): a request without a token is answered 401 by `Auth`.
 */
class BenchDefault extends AbstractController {
  get routes() {
    return { get: { '/': this.index } };
  }

  async index(_req: unknown, res: Response) {
    return res.json({ reached: true });
  }
}

export default BenchDefault;
