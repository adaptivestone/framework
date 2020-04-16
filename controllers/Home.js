const AbstractController = require('../modules/AbstractController');
const PrepareAppInfo = require('../services/http/middleware/PrepareAppInfo');
const GetUserByToken = require('../services/http/middleware/GetUserByToken');

class Home extends AbstractController {
  get routes() {
    return {
      get: {
        '/': 'home',
      },
    };
  }

  async home(req, res, next) {
    res.render('home');
  }

  static get isUseControllerNameForRouting() {
    return false;
  }
  static get middleware() {
    return new Map([['/', [PrepareAppInfo, GetUserByToken]]]);
  }
}

module.exports = Home;
