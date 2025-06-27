import crypto from "node:crypto";
import path from "node:path";
import { createClient } from "@redis/client";
import mongoose from "mongoose"; // we do not need create indexes on tests
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type redisConfig from "../config/redis.ts";
import { clearNamespace } from "../helpers/redis/clearNamespace.ts";
import Server from "../server.ts";
import { serverInstance, setServerInstance } from "./testHelpers.ts";

mongoose.set("autoIndex", false);

const basePath = new URL(".", import.meta.url).pathname;

beforeAll(async () => {
  process.env.LOGGER_CONSOLE_LEVEL = "error";
  process.env.AUTH_SALT = crypto.randomBytes(16).toString("hex");
  const server = new Server({
    folders: {
      config:
        process.env.TEST_FOLDER_CONFIG || path.resolve(basePath, "../config"),
      controllers:
        process.env.TEST_FOLDER_CONTROLLERS ||
        path.resolve(basePath, "../controllers"),
      models:
        process.env.TEST_FOLDER_MODELS || path.resolve(basePath, "../models"),
      emails:
        process.env.TEST_FOLDER_EMAIL ||
        process.env.TEST_FOLDER_EMAILS ||
        path.resolve(basePath, "../services/messaging/email/templates"),
      locales:
        process.env.TEST_FOLDER_LOCALES || path.resolve(basePath, "../locales"),
      commands:
        process.env.TEST_FOLDER_COMMANDS ||
        path.resolve(basePath, "../commands"),
      migrations:
        process.env.TEST_FOLDER_MIGRATIONS ||
        path.resolve(basePath, "../migrations"),
    },
  });
  setServerInstance(server);

  await server.init({ isSkipModelInit: true });
  const connectionString = (process.env.TEST_MONGO_URI as string).replace(
    "__DB_TO_REPLACE__",
    `TEST_${crypto.randomUUID()}`,
  );
  server.updateConfig("mongo", {
    connectionString,
  });
  server.updateConfig("http", { port: 0 }); // allow to use random
  server.updateConfig("mail", { transport: "stub" });
  await server.initAllModels();

  // if (!global.testSetup) {
  //   global.testSetup = {};
  // }
  // server.testingGetUrl = (urlPart) => {
  //   console.error(
  //     'global.server.testingGetUrl is deprcated. Please use testHelper.getServerBaseURL()',
  //   );
  //   return `http://127.0.0.1:${global.server.getConfig('http').port}${urlPart}`;
  // };

  // if (typeof global.testSetup.beforeAll === 'function') {
  //   await global.testSetup.beforeAll();
  // }
  await server.startServer();
});

beforeEach(() => {
  if (serverInstance) {
    const key = `test-${Math.random().toString(36).substring(7)}`;
    serverInstance.app.updateConfig("redis", {
      namespace: key,
    });
  }
});

afterEach(async () => {
  if (serverInstance) {
    const { url, namespace } = serverInstance.getConfig(
      "redis",
    ) as typeof redisConfig;
    const redisClient = createClient({ url });

    try {
      await redisClient.connect();
      await clearNamespace(redisClient, namespace);
      await redisClient.destroy();
    } catch {
      // that ok. No redis connection
    }
  }
});

afterAll(async () => {
  if (serverInstance) {
    serverInstance.app.httpServer?.shutdown();
    serverInstance.app.events.emit("shutdown");
  }
  // if (typeof global.testSetup.afterAll === 'function') {
  //   await global.testSetup.afterAll();
  // }
  try {
    await mongoose.connection.db?.dropDatabase(); // clean database after test
  } catch {
    // that ok. No mongoose connection
  }

  await mongoose.disconnect();
});
