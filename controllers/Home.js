const AbstractController = require('../modules/AbstractController');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');

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
    return new Map([['/*', [GetUserByToken]]]);
  }
}

module.exports = Home;
