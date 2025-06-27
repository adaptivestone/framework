import { describe, expect, it } from "vitest";
import { getTestServerURL } from "../tests/testHelpers.ts";

describe("home", () => {
  it("can open home have", async () => {
    expect.assertions(1);

    const { status } = await fetch(getTestServerURL("/")).catch(() => ({
      status: 500,
    }));

    expect(status).toBe(200);
  });
});
