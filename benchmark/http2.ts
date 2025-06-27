import fs from "node:fs";
import http2 from "node:http2";

const server = http2.createSecureServer({
  // we can read the certificate and private key from
  // our project directory
  key: fs.readFileSync("key.pem"),
  cert: fs.readFileSync("cert.pem"),
});

server.on("error", console.error);

server.on("stream", (stream) => {
  // we can use the `respond` method to send
  // any headers. Here, we send the status pseudo header
  stream.respond({
    ":status": 200,
    "content-type": "application/json; charset=utf-8",
  });

  stream.write(JSON.stringify({ hello: "world" }));
  stream.end();
});

server.listen(3300);

console.log("Server started on port 3300");
