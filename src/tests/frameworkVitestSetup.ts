import { afterAll, beforeAll } from "vitest";
import { createDefaultTestUser } from "./testHelpers.ts";

beforeAll(async () => {
  await createDefaultTestUser();
});

afterAll(async () => {
  // do seomthing
});
