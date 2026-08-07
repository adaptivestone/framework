import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import { assertCalledTimes, assertRejectsLike } from '../tests/assertions.ts';
import {
  mockRejectedValueOnce,
  mockResolvedValueOnce,
} from '../tests/mocks.ts';
import type { TSequence } from './Sequence.ts';

describe('sequence model', () => {
  it('should produce sequence', async () => {
    const SequenceModel: TSequence = appInstance.getModel('Sequence');

    const number1 = await SequenceModel.getSequence('typeOne');

    assert.strictEqual(number1, 1);
  });

  it('should produce sequence different for different types', async () => {
    const SequenceModel: TSequence = appInstance.getModel('Sequence');

    const number1 = await SequenceModel.getSequence('typeOneAgain');
    const number2 = await SequenceModel.getSequence('typeTwo');
    const number3 = await SequenceModel.getSequence('typeThree');

    assert.strictEqual(number1, 1);
    assert.strictEqual(number2, 1);
    assert.strictEqual(number3, 1);
  });

  it('should works on async env', async () => {
    const SequenceModel: TSequence = appInstance.getModel('Sequence');

    const promises: Promise<number>[] = [];
    const upTo = 100;
    for (let i = 0; i < upTo; i += 1) {
      promises.push(SequenceModel.getSequence('asyncTypeOne'));
    }

    const data = await Promise.all(promises);
    const summ = ((1 + upTo) / 2) * upTo; // Arithmetic progression

    const summ2 = data.reduce((a, b) => a + b, 0);

    assert.strictEqual(summ2, summ);
  });

  it('retries once when two upserts race to an E11000, returning the retry value', async () => {
    const SequenceModel: TSequence = appInstance.getModel('Sequence');
    const spy = mockResolvedValueOnce(
      mockRejectedValueOnce(mock.method(SequenceModel, 'findByIdAndUpdate'), {
        code: 11000,
      } as never),
      { seq: 7 } as never,
    );

    const n = await SequenceModel.getSequence('raceType');

    assert.strictEqual(n, 7);
    assertCalledTimes(spy, 2);
    spy.mock.restore();
  });

  it('rethrows a non-E11000 error without retrying', async () => {
    const SequenceModel: TSequence = appInstance.getModel('Sequence');
    const spy = mockRejectedValueOnce(
      mock.method(SequenceModel, 'findByIdAndUpdate'),
      Object.assign(new Error('db exploded'), { code: 121 }) as never,
    );

    await assertRejectsLike(
      SequenceModel.getSequence('errType'),
      'db exploded',
    );
    assertCalledTimes(spy, 1);
    spy.mock.restore();
  });
});
