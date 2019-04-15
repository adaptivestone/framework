const MongodbMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');

let mongoMemoryServerInstance;

const path = require("path");

beforeAll(async () => {
    jest.setTimeout(50000);
    mongoMemoryServerInstance = new MongodbMemoryServer();

    const uri = await mongoMemoryServerInstance.getConnectionString();
    await mongoose.connect(uri,{ useNewUrlParser: true });
    let Server = require("../server");
    global.server = new Server({
        folders:{
            config: path.resolve("./config"),
            controllers: path.resolve("./controllers"),
            views: path.resolve("./views"),
            public: path.resolve("./public"),
        }
    });
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoMemoryServerInstance.stop();
    global.server.app.httpServer.die();

});
