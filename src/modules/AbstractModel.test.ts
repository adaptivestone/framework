import mongoose from 'mongoose';
import { afterAll, describe, expect, it } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractModel from './AbstractModel.ts';

afterAll(() => {
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

    expect(wrapper.modelSchema).toEqual({});
    expect(wrapper.modelSchemaOptions).toEqual({});
    expect(AbstractModel.loggerGroup).toBe('model');
    expect(Model.getSuper()).toBe(wrapper);
    expect(document.getSuper()).toBe(wrapper);
  });
});
