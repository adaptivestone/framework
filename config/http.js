module.exports = {
  port: process.env.HTTP_PORT || 3300,
  hostname: "0.0.0.0",
  corsDomains: ["http://localhost:3000"],
  myDomain: process.env.HTTP_DOMAIN || "http://localhost:3300",
  siteDomain: process.env.FRONT_DOMAIN || "http://localhost:3000"
};
