import type { Response } from "express";
import { describe, expect, it } from "vitest";
import { appInstance } from "../../../helpers/appInstance.ts";
import type { FrameworkRequest } from "../HttpServer.ts";
import PrepareAppInfo from "./PrepareAppInfo.ts";

describe("prepareAppInfo methods", () => {
  it("have description fields", async () => {
    expect.assertions(1);

    // const middleware = new PrepareAppInfo(appInstance);

    expect(PrepareAppInfo.description).toBeDefined();
  });

  it("middleware that works", async () => {
    expect.assertions(3);

    const middleware = new PrepareAppInfo(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req: {
      appInfo?: {
        test: number;
      };
    } = {};
    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
    expect(req.appInfo).toBeDefined();

    if (req.appInfo) {
      req.appInfo.test = 5;
    }

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(req.appInfo?.test).toBe(5);
  });
});
