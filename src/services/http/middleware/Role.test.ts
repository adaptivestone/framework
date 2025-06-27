import type { Response } from "express";
import { describe, expect, it } from "vitest";
import { appInstance } from "../../../helpers/appInstance.ts";
import type { TUser } from "../../../models/User.ts";
import type { FrameworkRequest } from "../HttpServer.ts";
import type { GetUserByTokenAppInfo } from "./GetUserByToken.ts";
import Role from "./Role.ts";

describe("role middleware methods", () => {
  it("have description fields", async () => {
    expect.assertions(1);

    // const middleware = new Role(appInstance);

    expect(Role.description).toBeDefined();
  });

  it("middleware pass when user presented with a right role", async () => {
    expect.assertions(1);

    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: {
          roles: ["role1", "role2"],
        },
      },
    };
    const middleware = new Role(appInstance, {
      roles: ["admin", "role1"],
    });

    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
  });

  it("middleware NOT pass when user NOT presented", async () => {
    expect.assertions(3);

    let isCalled = false;
    let status;
    let isSend;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {}, // no user
    };
    const middleware = new Role(appInstance);
    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      } as Response,
      nextFunction,
    );

    expect(isCalled).toBeFalsy();
    expect(status).toBe(401);
    expect(isSend).toBeTruthy();
  });

  it("middleware NOT pass when user  have a wrong role", async () => {
    expect.assertions(3);

    let isCalled = false;
    let status;
    let isSend;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: { roles: ["role1", "role2"] },
      },
    };
    const middleware = new Role(appInstance, { roles: ["admin"] });
    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      } as Response,
      nextFunction,
    );

    expect(isCalled).toBeFalsy();
    expect(status).toBe(403);
    expect(isSend).toBeTruthy();
  });
});
