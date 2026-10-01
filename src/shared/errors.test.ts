import { describe, it, expect } from 'vitest';
import { AppError, toApiErrorResponse } from './errors.js';

const rid = 'req-0001';

describe('toApiErrorResponse', () => {
  it('AppError preserva code/status/message', () => {
    const err = new AppError('EMAIL_ALREADY_EXISTS', 409, 'E-mail já cadastrado');
    const r = toApiErrorResponse(err, rid);
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({
      error: { code: 'EMAIL_ALREADY_EXISTS', message: 'E-mail já cadastrado' },
      requestId: rid,
    });
  });

  it('AppError com details preserva details', () => {
    const err = new AppError('VALIDATION_ERROR', 400, 'Dados inválidos', [
      { field: 'amountCents', message: 'deve ser inteiro' },
    ]);
    const r = toApiErrorResponse(err, rid);
    expect(r.body.error.details).toEqual([{ field: 'amountCents', message: 'deve ser inteiro' }]);
  });

  it('erro Ajv required → 400 com field da propriedade faltante', () => {
    const ajv = {
      statusCode: 400,
      validationContext: 'body',
      validation: [
        {
          message: "must have required property 'email'",
          instancePath: '',
          schemaPath: '#/required',
          params: { missingProperty: 'email' },
        },
      ],
    };
    const r = toApiErrorResponse(ajv as never, rid);
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details).toEqual([{ field: 'email', message: "must have required property 'email'" }]);
  });

  it('erro Ajv additionalProperties aponta a propriedade extra', () => {
    const ajv = {
      statusCode: 400,
      validationContext: 'body',
      validation: [
        {
          message: 'must NOT have additional properties',
          instancePath: '',
          params: { additionalProperty: 'balanceCents' },
        },
      ],
    };
    const r = toApiErrorResponse(ajv as never, rid);
    expect(r.body.error.details?.[0]?.field).toBe('balanceCents');
  });

  it('erro Ajv type/pattern deriva field do instancePath', () => {
    const ajv = {
      statusCode: 400,
      validationContext: 'body',
      validation: [
        { message: 'must be integer', instancePath: '/amountCents', params: { type: 'integer' } },
        { message: 'must match pattern', instancePath: '/idempotencyKey', params: { pattern: 'x' } },
      ],
    };
    const r = toApiErrorResponse(ajv as never, rid);
    expect(r.body.error.details?.map((d) => d.field)).toEqual(['amountCents', 'idempotencyKey']);
  });

  it('erro Ajv em headers deriva field do header', () => {
    const ajv = {
      statusCode: 400,
      validationContext: 'headers',
      validation: [
        {
          message: 'must match pattern "^[A-Za-z0-9._:-]{8,128}$"',
          instancePath: '/idempotency-key',
          params: { pattern: '^[A-Za-z0-9._:-]{8,128}$' },
        },
      ],
    };
    const r = toApiErrorResponse(ajv as never, rid);
    expect(r.body.error.details?.[0]?.field).toBe('idempotency-key');
  });

  it('SqliteError com SQL vira 500 genérico sem vazar conteúdo', () => {
    const boom: Error & { code?: string } = Object.assign(new Error('UNIQUE constraint failed: users.email -- INSERT INTO users ...'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const r = toApiErrorResponse(boom, rid);
    expect(r.statusCode).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(r.body.error.message).not.toContain('INSERT');
    expect(r.body.error.message).not.toContain('users.email');
    expect(JSON.stringify(r.body)).not.toContain('stack');
  });

  it('FST_ERR_CTP_INVALID_JSON_BODY → 400 VALIDATION_ERROR', () => {
    const bad = Object.assign(new Error('Body cannot be empty when content-type is set to application/json'), {
      code: 'FST_ERR_CTP_INVALID_JSON_BODY',
      statusCode: 400,
    });
    const r = toApiErrorResponse(bad, rid);
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('erro desconhecido → 500 INTERNAL_ERROR sem stack', () => {
    const r = toApiErrorResponse(new Error('boom at src/secret.ts:42'), rid);
    expect(r.statusCode).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(r.body.error.message).toBe('Erro interno. Tente novamente.');
    expect(JSON.stringify(r.body)).not.toContain('secret.ts');
  });
});
