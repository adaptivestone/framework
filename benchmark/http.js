const http = require('node:http');

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ hello: 'world' }));
});

server.listen(3300);

console.log('Server started on port 3300');
