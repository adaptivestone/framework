import AbstractController from '../modules/AbstractController.js';
import GetUserByToken from '../services/http/middleware/GetUserByToken.js';

class Home extends AbstractController {
  get routes() {
    return {
      get: {
        '/': this.home,
      },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async home(req, res) {
    return res.json({ message: 'Home' });
  }

  // eslint-disable-next-line class-methods-use-this
  getHttpPath() {
    return '/';
  }

  static get middleware() {
    return new Map([['/{*splat}', [GetUserByToken]]]);
  }
}

export default Home;
