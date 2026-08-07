import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractModel from './AbstractModel.ts';

after(() => {
  if (mongoose.modelNames().includes('AbstractModel')) {
    mongoose.deleteModel('AbstractModel');
  }
});

describe('AbstractModel defaults', () => {
  it('builds a usable empty model and exposes its owning wrapper', () => {
    const wrapper = new AbstractModel(appInstance);
    const Model = wrapper.mongooseModel as typeof wrapper.mongooseModel & {
      getSuper: () => AbstractModel;
    };
    const document = new Model() as InstanceType<typeof Model> & {
      getSuper: () => AbstractModel;
    };

    assert.deepStrictEqual(wrapper.modelSchema, {});
    assert.deepStrictEqual(wrapper.modelSchemaOptions, {});
    assert.strictEqual(AbstractModel.loggerGroup, 'model');
    assert.strictEqual(Model.getSuper(), wrapper);
    assert.strictEqual(document.getSuper(), wrapper);
  });
});
