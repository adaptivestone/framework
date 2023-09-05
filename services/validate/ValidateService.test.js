import { describe, it, expect } from 'vitest';

const yup = require('yup');
const ValidateService = require('./ValidateService');
const YupValidator = require('./drivers/YupValidator');
const CustomValidator = require('./drivers/CustomValidator');

describe('validate service', () => {
  describe('validateSchema funtion', () => {
    const data = {
      name: '1213123123',
    };
    const req = {};

    it('returns an empty object if no validator is provided', async () => {
      expect.assertions(1);
      const result = await new ValidateService(
        global.server.app,
        new YupValidator(
          global.server.app,
          yup.object().shape({ name: '123' }),
        ),
      ).validateSchema(req, undefined, data);
      expect(result).toStrictEqual({});
    });

    it('calls validateFields and castFields if validator is provided', async () => {
      expect.assertions(1);
      const validator = new YupValidator(
        global.server.app,
        yup.object().shape({ name: yup.string() }),
      );
      const result = await new ValidateService(
        global.server.app,
        {},
      ).validateSchema(req, validator, data);
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
      expect(result).toBe(false);
    });

    it('returns true if validator is an instance of one of the drivers', () => {
      expect.assertions(1);
      const validator = new ValidateService.drivers.YupValidator();
      const result = ValidateService.isValidatorExists(validator);
      expect(result).toBe(true);
    });

    it('returns false if validator is not an instance of any of the drivers', () => {
      expect.assertions(1);
      const validator = {};
      const result = ValidateService.isValidatorExists(validator);
      expect(result).toBe(false);
    });
  });

  describe('getDriverByValidatorBody', () => {
    it('should return the body if it is already a validator', () => {
      expect.assertions(1);
      const body = new YupValidator(
        global.server.app,
        yup.object().shape({ name: yup.string() }),
      );

      const validator = ValidateService.getDriverByValidatorBody(
        global.server.app,
        body,
      );

      expect(validator).toStrictEqual(body);
    });

    it('should return a YupValidator instance if the body is a Yup schema', () => {
      expect.assertions(1);
      const body = yup.object().shape({
        name: '1234',
      });

      const validator = ValidateService.getDriverByValidatorBody(
        global.server.app,
        body,
      );

      expect(validator).toBeInstanceOf(YupValidator);
    });

    it('should return CustomValidator if the body is neither a validator nor a Yup schema', () => {
      expect.assertions(1);
      const body = 'string';
      const validator = ValidateService.getDriverByValidatorBody(
        global.server.app,
        body,
      );

      expect(validator).toBeInstanceOf(CustomValidator);
    });
  });
});
