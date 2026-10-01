import { describe, expect, it } from 'vitest';
import {
  AppError,
  ajvErrorsToDetails,
  conflict,
  toApiErrorResponse,
  unprocessable,
  validationError,
} from './errors.js';

describe('toApiErrorResponse', () => {
  it('AppError preserva code/status/message/details', () => {
    const err = conflict('IDEMPOTENCY_CONFLICT', 'payload diferente para a mesma chave');
    const { statusCode, body } = toApiErrorResponse(err, 'req-1');
    expect(statusCode).toBe(409);
    expect(body).toEqual({
      error: { code: 'IDEMPOTENCY_CONFLICT', message: 'payload diferente para a mesma chave' },
      requestId: 'req-1',
    });
  });

  it('validationError inclui details', () => {
    const err = validationError([{ field: 'email', message: 'formato inválido' }]);
    const { statusCode, body } = toApiErrorResponse(err, 'req-2');
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ field: 'email', message: 'formato inválido' }]);
  });

  it('422 preservado', () => {
    const { statusCode, body } = toApiErrorResponse(
      unprocessable('SELF_TRANSFER', 'não pode transferir para si'),
      'r',
    );
    expect(statusCode).toBe(422);
    expect(body.error.code).toBe('SELF_TRANSFER');
  });

  it('erro Ajv required → field do missingProperty', () => {
    const details = ajvErrorsToDetails(
      [{ keyword: 'required', instancePath: '', params: { missingProperty: 'email' }, message: "must have required property 'email'" }],
      'body',
    );
    expect(details).toEqual([{ field: 'email', message: "must have required property 'email'" }]);
  });

  it('erro Ajv additionalProperties → field da propriedade extra', () => {
    const { statusCode, body } = toApiErrorResponse(
      {
        validation: [
          { keyword: 'additionalProperties', instancePath: '', params: { additionalProperty: 'balanceCents' }, message: 'must NOT have additional properties' },
        ],
        validationContext: 'body',
      },
      'r',
    );
    expect(statusCode).toBe(400);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(body.error.details).toEqual([
      { field: 'balanceCents', message: 'must NOT have additional properties' },
    ]);
  });

  it('erro Ajv type/pattern → field do instancePath', () => {
    const { body } = toApiErrorResponse(
      {
        validation: [
          { keyword: 'type', instancePath: '/amountCents', message: 'must be integer' },
          { keyword: 'pattern', instancePath: '/email', message: 'must match pattern' },
        ],
        validationContext: 'body',
      },
      'r',
    );
    expect(body.error.details).toEqual([
      { field: 'amountCents', message: 'must be integer' },
      { field: 'email', message: 'must match pattern' },
    ]);
  });

  it('erro SqliteError com SQL vaza nada: vira 500 genérico', () => {
    const sqliteErr = Object.assign(new Error('insert into users(email) values (...) - UNIQUE constraint failed: users.email'), {
      name: 'SqliteError',
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    const { statusCode, body } = toApiErrorResponse(sqliteErr, 'r');
    expect(statusCode).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
      requestId: 'r',
    });
    expect(JSON.stringify(body)).not.toMatch(/insert|UNIQUE|users/i);
  });

  it('JSON inválido do body parser → 400 VALIDATION_ERROR', () => {
    const { statusCode, body } = toApiErrorResponse(
      Object.assign(new Error('Unexpected token'), { code: 'FST_ERR_CTP_INVALID_JSON_BODY' }),
      'r',
    );
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AppError é instanceof Error com details opcional', () => {
    const e = new AppError('NOT_FOUND', 404, 'x');
    expect(e).toBeInstanceOf(Error);
    expect('details' in e && e.details).toBeUndefined();
  });
});
