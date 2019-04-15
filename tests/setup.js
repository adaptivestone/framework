const MongodbMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');

let mongoMemoryServerInstance;
let server;

beforeAll(async () => {
    jest.setTimeout(50000);
    mongoMemoryServerInstance = new MongodbMemoryServer();

    const uri = await mongoMemoryServerInstance.getConnectionString();
    await mongoose.connect(uri,{ useNewUrlParser: true });
    server = require("../server");

});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoMemoryServerInstance.stop();
    server.app.httpServer.die();

});