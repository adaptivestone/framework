import { describe, it, expect } from 'vitest';
import { appInstance } from '../../helpers/appInstance.ts';

import { object, string } from 'yup';
import ValidateService from './ValidateService.js';
import YupValidator from './drivers/YupValidator.js';
import CustomValidator from './drivers/CustomValidator.js';

describe('validate service', () => {
  describe('validateSchema funtion', () => {
    const data = {
      name: '1213123123',
    };
    const req = {};

    it('returns an empty object if no validator is provided', async () => {
      expect.assertions(1);

      const result = await new ValidateService(
        appInstance,
        new YupValidator(appInstance, object().shape({ name: string() })),
      ).validateSchema(req, undefined, data);

      expect(result).toStrictEqual({});
    });

    it('calls validateFields and castFields if validator is provided', async () => {
      expect.assertions(1);

      const validator = new YupValidator(
        appInstance,
        object().shape({ name: string() }),
      );
      const result = await new ValidateService(appInstance, {}).validateSchema(
        req,
        validator,
        data,
      );

      expect(result).toStrictEqual({
        name: '1213123123',
      });
    });
  });

  describe('isValidatorExists funtion', () => {
    it('returns false for non-object input', () => {
      expect.assertions(1);

      const validator = 'not an object';
      const result = ValidateService.isValidatorExists(validator);

      expect(result).toBeFalsy();
    });

    it('returns true if validator is an instance of one of the drivers', () => {
      expect.assertions(1);

      const validator = new ValidateService.drivers.YupValidator();
      const result = ValidateService.isValidatorExists(validator);

      expect(result).toBeTruthy();
    });

    it('returns false if validator is not an instance of any of the drivers', () => {
      expect.assertions(1);

      const validator = {};
      const result = ValidateService.isValidatorExists(validator);

      expect(result).toBeFalsy();
    });
  });

  describe('getDriverByValidatorBody', () => {
    it('should return the body if it is already a validator', () => {
      expect.assertions(1);

      const body = new YupValidator(
        appInstance,
        object().shape({ name: string() }),
      );

      const validator = ValidateService.getDriverByValidatorBody(
        appInstance,
        body,
      );

      expect(validator).toStrictEqual(body);
    });

    it('should return a YupValidator instance if the body is a Yup schema', () => {
      expect.assertions(1);

      const body = object().shape({
        name: string(),
      });

      const validator = ValidateService.getDriverByValidatorBody(
        appInstance,
        body,
      );

      expect(validator).toBeInstanceOf(YupValidator);
    });

    it('should return CustomValidator if the body is neither a validator nor a Yup schema', () => {
      expect.assertions(1);

      const body = 'string';
      const validator = ValidateService.getDriverByValidatorBody(
        appInstance,
        body,
      );

      expect(validator).toBeInstanceOf(CustomValidator);
    });
  });
});
