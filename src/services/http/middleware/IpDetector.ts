import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { NextFunction, Response } from 'express';
import type ipDetectorConfig from '../../../config/ipDetector.ts';
import type { IApp } from '../../../server.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

class IpDetector extends AbstractMiddleware {
  static get description() {
    return 'Detect real user IP address. Support proxy and load balancer';
  }

  blockList: BlockList;

  constructor(app: IApp, params?: Record<string, unknown>) {
    super(app, params);
    const { trustedProxy } = this.app.getConfig(
      'ipDetector',
    ) as typeof ipDetectorConfig;

    this.blockList = new BlockList();

    for (const subnet of trustedProxy) {
      const addressType = subnet.includes(':') ? 'ipv6' : 'ipv4';
      if (subnet.includes('/')) {
        // CIDR
        const [realSubnet, prefixLength] = subnet.split('/');
        this.blockList.addSubnet(
          realSubnet,
          parseInt(prefixLength, 10),
          addressType,
        );
      } else if (subnet.includes('-')) {
        // RANGE
        const [start, end] = subnet.split('-');
        this.blockList.addRange(start, end, addressType);
      } else {
        // just an address
        this.blockList.addAddress(subnet, addressType);
      }
    }
  }

  getIpAdressFromIncomingMessage(req: IncomingMessage) {
    const { headers } = this.app.getConfig(
      'ipDetector',
    ) as typeof ipDetectorConfig;
    const initialIp = req.socket.remoteAddress;
    let ip = initialIp;
    const initialType = initialIp?.includes(':') ? 'ipv6' : 'ipv4';

    // Only honor forwarding headers when the socket peer is itself a trusted
    // proxy — otherwise a direct client could spoof its own address.
    if (this.blockList.check(initialIp ?? '', initialType)) {
      for (const header of headers) {
        // first present header wins
        const ipHeader = req.headers[header.toLowerCase()] as string;
        if (!ipHeader) {
          continue;
        }
        // Standard reverse proxies APPEND the real client IP, so the chain
        // reads `<client-supplied…>, <real client>, <inner proxies>`. Walk it
        // right-to-left (closest hop first): the first entry that is NOT a
        // trusted proxy is the client. Cap the scan so a hostile header with
        // thousands of entries can't burn CPU.
        const entries = ipHeader.split(',').map((entry) => entry.trim());
        const stopAt = Math.max(0, entries.length - 20);
        for (let i = entries.length - 1; i >= stopAt; i -= 1) {
          const candidate = entries[i];
          // A non-IP entry means the left part of the chain is attacker-
          // controlled garbage — stop and keep the last trustworthy value.
          if (isIP(candidate) === 0) {
            break;
          }
          ip = candidate;
          // addressType must be per-candidate: an IPv6 socket can still carry
          // IPv4 entries in the header (and vice versa).
          const type = candidate.includes(':') ? 'ipv6' : 'ipv4';
          if (!this.blockList.check(candidate, type)) {
            // first untrusted hop = the client
            break;
          }
          // else: trusted proxy, keep walking left. If every entry is trusted
          // the loop ends with `ip` = the left-most examined entry.
        }
        break;
      }
    }
    return ip;
  }

  async middleware(req: FrameworkRequest, _res: Response, next: NextFunction) {
    req.appInfo.ip = this.getIpAdressFromIncomingMessage(req);
    next();
  }
}

export default IpDetector;
