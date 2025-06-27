import type { NextFunction, Response } from "express";
import type { TUser } from "../../../models/User.ts";
import type { FrameworkRequest } from "../HttpServer.ts";
import AbstractMiddleware from "./AbstractMiddleware.ts";
import type { GetUserByTokenAppInfo } from "./GetUserByToken.ts";

class RoleMiddleware extends AbstractMiddleware {
  static get description() {
    return "Check user role (user.roles property). If the user has no role then stop request and return error. OR logic (any role will pass user)";
  }

  async middleware(
    req: FrameworkRequest &
      GetUserByTokenAppInfo & { user: InstanceType<TUser> },
    res: Response,
    next: NextFunction,
  ) {
    const { user } = req.appInfo;

    if (!user) {
      return res.status(401).json({ message: "User should be provided" });
    }

    let hasRole = false;
    user.roles?.forEach((role: string) => {
      if ((this.params?.roles as Array<string>).includes(role)) {
        hasRole = true;
      }
    });

    if (!hasRole) {
      return res.status(403).json({ message: "You do not have access" });
    }
    return next();
  }
}

export default RoleMiddleware;
