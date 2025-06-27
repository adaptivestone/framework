import { BlockList } from "node:net";
import type { NextFunction, Response } from "express";
import type ipDetectorConfig from "../../../config/ipDetector.ts";
import type { IApp } from "../../../server.ts";
import type { FrameworkRequest } from "../HttpServer.ts";
import AbstractMiddleware from "./AbstractMiddleware.ts";

class IpDetector extends AbstractMiddleware {
  static get description() {
    return "Detect real user IP address. Support proxy and load balancer";
  }

  blockList: BlockList;

  constructor(app: IApp, params?: Record<string, unknown>) {
    super(app, params);
    const { trustedProxy } = this.app.getConfig(
      "ipDetector",
    ) as typeof ipDetectorConfig;

    this.blockList = new BlockList();

    for (const subnet of trustedProxy) {
      const addressType = subnet.includes(":") ? "ipv6" : "ipv4";
      if (subnet.includes("/")) {
        // CIDR
        const [realSubnet, prefixLength] = subnet.split("/");
        this.blockList.addSubnet(
          realSubnet,
          parseInt(prefixLength, 10),
          addressType,
        );
      } else if (subnet.includes("-")) {
        // RANGE
        const [start, end] = subnet.split("-");
        this.blockList.addRange(start, end, addressType);
      } else {
        // just an address
        this.blockList.addAddress(subnet, addressType);
      }
    }
  }

  async middleware(req: FrameworkRequest, res: Response, next: NextFunction) {
    const { headers } = this.app.getConfig(
      "ipDetector",
    ) as typeof ipDetectorConfig;
    const initialIp = req.socket.remoteAddress;
    req.appInfo.ip = initialIp;
    const addressType = initialIp?.includes(":") ? "ipv6" : "ipv4";

    if (this.blockList.check(initialIp ?? "", addressType)) {
      // we can trust this source
      for (const header of headers) {
        // in a range
        const ipHeader = req.headers[header.toLowerCase()] as string;
        if (ipHeader) {
          const [firstIp] = ipHeader.split(",").map((ip) => ip.trim());
          req.appInfo.ip = firstIp;
          break;
        }
      }
    }
    next();
  }
}

export default IpDetector;
