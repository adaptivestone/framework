const MongodbMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');

let mongoMemoryServerInstance;

const path = require("path");

beforeAll(async () => {
    jest.setTimeout(50000);
    mongoMemoryServerInstance = new MongodbMemoryServer();

    let connectionStringMongo = await mongoMemoryServerInstance.getConnectionString();
    let Server = require("../server");
    global.server = new Server({
        folders:{
            config: path.resolve("./config"),
            controllers: path.resolve("./controllers"),
            views: path.resolve("./views"),
            public: path.resolve("./public"),
            models: path.resolve("./models")
        }
    });
    global.server.updateConfig("mongo",{connectionString:connectionStringMongo});
    global.server.updateConfig("http",{port:0});// allow to use random
    global.server.updateConfig("mail",{transport:"stub"});

    let User =  global.server.app.getModel("User");
    user = await User.create({
        email: "test@test.com",
        password: "testPassword",
        isVerified:true,
        name: {
            nick: "testUserNickName"   
        }
    });
    global.authToken = await user.generateToken()
    
    await global.server.startServer();
});

afterAll(async () => {
    global.server.app.httpServer.die();
    setTimeout(async()=>{
        await mongoose.disconnect();
        await mongoMemoryServerInstance.stop();
    },500)
   
});