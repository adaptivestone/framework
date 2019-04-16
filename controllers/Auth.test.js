let express;
const request = require("supertest");
const userEmail = "test@test.com";
const userPassword = "SuperNiceSecret123$";

beforeAll(() => {
  express = global.server.app.httpServer.express;
});

describe("REGISTRATION", () => {
  test("NOT able to create user with wrong email", async () => {
    return request(express)
      .post("/auth/register")
      .send({
        email: "bad email",
        password: userPassword,
        nickName: "test"
      })
      .expect(400);
  });

  test("can create user", async () => {
    return request(express)
      .post("/auth/register")
      .send({
        email: userEmail,
        password: userPassword,
        nickName: "test"
      })
      .expect(200, {
        success: true
      });
  });

  test("can NOT create SAME user", async () => {
    return request(express)
      .post("/auth/register")
      .send({
        email: userEmail,
        password: userPassword,
        nickName: "test"
      })
      .expect(400);
  });
});

describe("LOGIN", () => {
  test("can NOT login with normal creds and not Verifyed email", async () => {
    return request(express)
      .post("/auth/login")
      .send({
        email: userEmail,
        password: userPassword
      })
      .expect(400);
  });

  test("can NOT login with WRONG creds ", async () => {
    return request(express)
      .post("/auth/login")
      .send({
        email: "test@test.by",
        password: "noPassword$"
      })
      .expect(400);
  });

  test("can  login with normal creds and  verifyed email", async () => {
    let user = await global.server.app
      .getModel("User")
      .findOne({ email: userEmail });
    user.isVerified = true;
    await user.save();
    return request(express)
      .post("/auth/login")
      .send({
        email: userEmail,
        password: userPassword
      })
      .expect(200)
      .then(responce => {
        expect(responce.body.success).toBe(true);
        expect(responce.body.token).toBeDefined();
      });
  });
});
