const MongodbMemoryServer = require('mongodb-memory-server').MongoMemoryServer;
const mongoose = require('mongoose');

let mongoMemoryServerInstance;

const path = require("path");

beforeAll(async () => {
    jest.setTimeout(50000);
    mongoMemoryServerInstance = new MongodbMemoryServer();
    process.env.LOG_LEVEL = "error";

    let connectionStringMongo = await mongoMemoryServerInstance.getConnectionString();
    let Server = require("../server");
    global.server = new Server({
        folders:{
            config: process.env.TEST_FOLDER_CONFIG ||path.resolve("./config"),
            controllers: process.env.TEST_FOLDER_CONTROLLERS || path.resolve("./controllers"),
            views: process.env.TEST_FOLDER_VIEWS || path.resolve("./views"),
            public: process.env.TEST_FOLDER_PUBLIC || path.resolve("./public"),
            models: process.env.TEST_FOLDER_MODELS || path.resolve("./models"),
            email: process.env.TEST_FOLDER_EMAIL || path.resolve("./services/messaging/email/templates")
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
    global.authToken = await user.generateToken();
    
    await global.server.startServer();
});

afterAll(async () => {
    global.server.app.httpServer.die();
    setTimeout(async()=>{
        await mongoose.disconnect();
        await mongoMemoryServerInstance.stop();
    },500)
   
});