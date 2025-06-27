import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import type { NextFunction, Response } from "express";
import { PersistentFile } from "formidable";
import { describe, expect, it } from "vitest";
import { appInstance } from "../../../helpers/appInstance.ts";
import type { FrameworkRequest } from "../HttpServer.ts";

import RequestParser from "./RequestParser.ts";

describe("reqest parser limiter methods", () => {
  it("have description fields", async () => {
    expect.assertions(1);

    // const middleware = new RequestParser(appInstance);

    expect(RequestParser.description).toBeDefined();
  });

  it("middleware that works", async () => {
    expect.assertions(4);

    await new Promise<boolean>((done) => {
      // from https://github.com/node-formidable/formidable/blob/master/test-node/standalone/promise.test.js

      const server = createServer(async (req: IncomingMessage, res) => {
        // Add appInfo property to req
        (req as unknown as FrameworkRequest).appInfo = {
          app: appInstance,
          request: {},
          query: {},
        };

        const middleware = new RequestParser(appInstance);
        middleware.middleware(
          req as FrameworkRequest,
          {} as Response,
          ((err?: Error) => {
            expect(err).toBeUndefined();

            // Get the body once to avoid linting issues
            const reqBody = (req as unknown as FrameworkRequest).body;
            expect(reqBody.title).toBeDefined();
            expect(reqBody.multipleFiles).toBeDefined();
            expect(
              reqBody.multipleFiles[0] instanceof PersistentFile,
            ).toBeTruthy();

            res.writeHead(200);
            res.end("ok");
          }) as NextFunction,
        );
      });
      server.listen(null, async () => {
        const address = server.address();
        const chosenPort = typeof address === "string" ? 0 : address?.port;
        const body = `----13068458571765726332503797717\r
Content-Disposition: form-data; name="title"\r
\r
a\r
----13068458571765726332503797717\r
Content-Disposition: form-data; name="multipleFiles"; filename="x.txt"\r
Content-Type: application/x-javascript\r
\r
\r
\r
a\r
b\r
c\r
d\r
\r
----13068458571765726332503797717--\r
`;
        await fetch(String(new URL(`http:localhost:${chosenPort}/`)), {
          method: "POST",
          headers: {
            "Content-Length": body.length.toString(),
            Host: `localhost:${chosenPort}`,
            "Content-Type":
              "multipart/form-data; boundary=--13068458571765726332503797717",
          },
          body,
        }).catch((err) => {
          console.error(err);
          done(err);
        });
        server.close(() => {
          done(true);
        });
      });
    });
  });

  it("middleware with a problem", async () => {
    expect.assertions(1);

    await new Promise<boolean>((done) => {
      // from https://github.com/node-formidable/formidable/blob/master/test-node/standalone/promise.test.js

      const server = createServer(async (req: IncomingMessage, res) => {
        const frReq = {
          ...req,
          appInfo: {
            app: appInstance,
            request: {},
            query: {},
          },
          body: {},
        } as FrameworkRequest;
        const middleware = new RequestParser(appInstance);
        let status = 0;

        const resp = {
          status: (code: number) => {
            status = code;
            return resp;
          },
          json: () => resp,
        };
        await middleware.middleware(
          frReq,
          resp as Response,
          (() => {}) as NextFunction,
        );

        expect(status).toBe(400);
        // expect(err).toBeDefined();

        res.writeHead(200);
        res.end("ok");
      });
      server.listen(null, async () => {
        const address = server.address();
        const chosenPort = typeof address === "string" ? 0 : address?.port;
        const body = "someBadBody";

        await fetch(String(new URL(`http:localhost:${chosenPort}/`)), {
          method: "POST",
          headers: {
            "Content-Length": body.length.toString(),
            Host: `localhost:${chosenPort}`,
            "Content-Type": "badContentType",
          },
          body,
        }).catch((err) => {
          console.error(err);
          done(err);
        });
        server.close(() => {
          done(true);
        });
      });
    });
  });
});
