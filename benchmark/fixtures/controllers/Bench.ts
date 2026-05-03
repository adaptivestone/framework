import type { Response } from 'express';
import { object, string } from 'yup';
import AbstractController from '../../../src/modules/AbstractController.ts';
import type { FrameworkRequest } from '../../../src/services/http/HttpServer.ts';

class Bench extends AbstractController {
  get routes() {
    return {
      get: {
        '/plaintext': this.plaintext,
        '/echo': {
          handler: this.echo,
          query: object().shape({
            name: string().required(),
          }),
        },
      },
    };
  }

  async plaintext(_req: FrameworkRequest, res: Response) {
    return res.json({ hello: 'world' });
  }

  async echo(
    req: FrameworkRequest & {
      appInfo: { query: { name: string } };
    },
    res: Response,
  ) {
    const message = req.appInfo.i18n?.t('auth.userProvided') ?? 'fallback';
    return res.json({ name: req.appInfo.query.name, message });
  }

  static get middleware() {
    return new Map();
  }
}

export default Bench;
