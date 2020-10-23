const Socketio = require('socket.io');
const AbstractConnector = require('../../../modules/AbstractConnector');

class WebSocket extends AbstractConnector {
  constructor(app) {
    super(app);
    this.sockets = [];
    this.io = new Socketio(this.app.httpServer.httpServer, {
      transports: ['websocket', 'polling'],
    });
    this.io.on('connection', (socket) => {
      socket.on('add_user', async (token) => {
        const UserModel = this.app.getModel('User');
        const user = await UserModel.getUserByToken(token);
        if (user) {
          this.logger.info(`Adding socket props ${user._id.toString()}`);
          socket.user_id = user._id;
          this.sockets.push(socket);
        }
      });
    });
  }

  /**
   * Send message to seleceted users
   * @param type string
   * @param data Object
   * @param [to] array
   */
  async send(type, data, to = []) {
    this.logger.info(
      `Send data type:'${type}' to '${to.join()}' data:'${JSON.stringify(
        data,
      )}'`,
    );
    const users = await this.getSocketsByUsers(to);
    for (const user of users) {
      // this.logger.info(`emmit data to user ${user}`);
      user.emit(type, data);
    }
  }

  /**
   * Get connected users
   * @param ids array|string
   * @returns [<sockets>]
   */
  async getSocketsByUsers(ids = []) {
    if (!Array.isArray(ids)) {
      ids = [ids];
    }
    const arr = await ids.map((el) => {
      return JSON.stringify(el);
    });
    if (!ids.length) {
      return this.sockets;
    }
    const arr2 = await this.sockets.filter((val) => {
      return val && arr.includes(JSON.stringify(val.user_id));
    });
    return arr2;
  }
}

module.exports = WebSocket;
