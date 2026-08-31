import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import type { TKeyValue } from './KeyValue.ts';

// `genTypes.d.ts` is not part of this repo's own tsc program, so `getModel`
// resolves to the untyped fallback here. Same cast the shared test helpers use.
const getKeyValueModel = () =>
  appInstance.getModel('KeyValue') as unknown as TKeyValue;

describe('keyValue model', () => {
  it('should store and read a value', async () => {
    const KeyValue = getKeyValueModel();

    await KeyValue.findByIdAndUpdate(
      'config:theme',
      { value: 'dark' },
      { upsert: true },
    );
    const doc = await KeyValue.findById('config:theme');

    assert.strictEqual(doc?.value, 'dark');
  });

  it('should store any value type', async () => {
    const KeyValue = getKeyValueModel();

    const value = { enabled: true, limits: [1, 2, 3] };
    await KeyValue.findByIdAndUpdate(
      'config:feature',
      { value },
      { upsert: true },
    );
    const doc = await KeyValue.findById('config:feature');

    assert.deepStrictEqual(doc?.value, value);
  });

  it('should overwrite an existing key', async () => {
    const KeyValue = getKeyValueModel();

    await KeyValue.findByIdAndUpdate('counter', { value: 1 }, { upsert: true });
    await KeyValue.findByIdAndUpdate('counter', { value: 2 }, { upsert: true });
    const doc = await KeyValue.findById('counter');

    assert.strictEqual(doc?.value, 2);
  });

  it('should delete a value', async () => {
    const KeyValue = getKeyValueModel();

    await KeyValue.findByIdAndUpdate('temp', { value: 'x' }, { upsert: true });
    await KeyValue.deleteOne({ _id: 'temp' });
    const doc = await KeyValue.findById('temp');

    assert.strictEqual(doc, null);
  });
});
