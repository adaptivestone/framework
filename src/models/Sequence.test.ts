import { describe, expect, it } from "vitest";
import { appInstance } from "../helpers/appInstance.ts";
import type { TSequence } from "./Sequence.ts";

describe("sequence model", () => {
  it("should produce sequence", async () => {
    expect.assertions(1);

    const SequenceModel: TSequence = appInstance.getModel("Sequence");

    const number1 = await SequenceModel.getSequence("typeOne");

    expect(number1).toBe(1);
  });

  it("should produce sequence different for different types", async () => {
    expect.assertions(3);

    const SequenceModel: TSequence = appInstance.getModel("Sequence");

    const number1 = await SequenceModel.getSequence("typeOneAgain");
    const number2 = await SequenceModel.getSequence("typeTwo");
    const number3 = await SequenceModel.getSequence("typeThree");

    expect(number1).toBe(1);
    expect(number2).toBe(1);
    expect(number3).toBe(1);
  });

  it("should works on async env", async () => {
    expect.assertions(1);

    const SequenceModel: TSequence = appInstance.getModel("Sequence");

    const promises: Promise<number>[] = [];
    const upTo = 100;
    for (let i = 0; i < upTo; i += 1) {
      promises.push(SequenceModel.getSequence("asyncTypeOne"));
    }

    const data = await Promise.all(promises);
    const summ = ((1 + upTo) / 2) * upTo; // Arithmetic progression

    const summ2 = data.reduce((a, b) => a + b, 0);

    expect(summ2).toBe(summ);
  });
});
