import { describe, expect, it } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import type { TKeyValue } from './KeyValue.ts';

describe('keyValue model', () => {
  it('should store and read a value', async () => {
    expect.assertions(1);

    const KeyValue: TKeyValue = appInstance.getModel('KeyValue');

    await KeyValue.findByIdAndUpdate(
      'config:theme',
      { value: 'dark' },
      { upsert: true },
    );
    const doc = await KeyValue.findById('config:theme');

    expect(doc?.value).toBe('dark');
  });

  it('should store any value type', async () => {
    expect.assertions(1);

    const KeyValue: TKeyValue = appInstance.getModel('KeyValue');

    const value = { enabled: true, limits: [1, 2, 3] };
    await KeyValue.findByIdAndUpdate(
      'config:feature',
      { value },
      { upsert: true },
    );
    const doc = await KeyValue.findById('config:feature');

    expect(doc?.value).toStrictEqual(value);
  });

  it('should overwrite an existing key', async () => {
    expect.assertions(1);

    const KeyValue: TKeyValue = appInstance.getModel('KeyValue');

    await KeyValue.findByIdAndUpdate('counter', { value: 1 }, { upsert: true });
    await KeyValue.findByIdAndUpdate('counter', { value: 2 }, { upsert: true });
    const doc = await KeyValue.findById('counter');

    expect(doc?.value).toBe(2);
  });

  it('should delete a value', async () => {
    expect.assertions(1);

    const KeyValue: TKeyValue = appInstance.getModel('KeyValue');

    await KeyValue.findByIdAndUpdate('temp', { value: 'x' }, { upsert: true });
    await KeyValue.deleteOne({ _id: 'temp' });
    const doc = await KeyValue.findById('temp');

    expect(doc).toBeNull();
  });
});
