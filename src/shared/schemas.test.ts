import { describe, it, expect, beforeAll } from 'vitest';
import { Ajv } from 'ajv';
import * as addFormatsModule from 'ajv-formats';

const addFormats = (addFormatsModule as unknown as { default: (ajv: Ajv) => Ajv }).default;
import {
  ajvOptions,
  signupBodySchema,
  signinBodySchema,
  addContactBodySchema,
  requestTransferBodySchema,
  idempotencyKeyHeaderSchema,
  listTransfersQuerystringSchema,
  responseSchemas,
} from './schemas.js';

let ajv: Ajv;

beforeAll(() => {
  ajv = new Ajv({ ...ajvOptions });
  addFormats(ajv);
});

const validate = (schema: object, data: unknown) => {
  const v = ajv.compile(schema as never);
  return v(data);
};

describe('request schemas sem coerção', () => {
  it('amountCents rejeita string numérica, float, 0 e acima do máximo', () => {
    const mk = (amountCents: unknown) => ({ recipientAccountId: 'acc-bruno', amountCents });
    expect(validate(requestTransferBodySchema, mk('100'))).toBe(false);
    expect(validate(requestTransferBodySchema, mk(10.5))).toBe(false);
    expect(validate(requestTransferBodySchema, mk(0))).toBe(false);
    expect(validate(requestTransferBodySchema, mk(100000001))).toBe(false);
    expect(validate(requestTransferBodySchema, mk(1))).toBe(true);
    expect(validate(requestTransferBodySchema, mk(100000000))).toBe(true);
  });

  it('rejeita propriedades extras e currency no body de transferência', () => {
    expect(validate(requestTransferBodySchema, { recipientAccountId: 'acc-bruno', amountCents: 100, sourceAccountId: 'acc-alice' })).toBe(false);
    expect(validate(requestTransferBodySchema, { recipientAccountId: 'acc-bruno', amountCents: 100, currency: 'BRL' })).toBe(false);
    expect(validate(requestTransferBodySchema, { recipientAccountId: 'acc-bruno', amountCents: 100, note: 'Almoço' })).toBe(true);
  });

  it('signup rejeita extras e falta de campos', () => {
    expect(validate(signupBodySchema, { name: 'A', email: 'a@b.co', password: '12345678' })).toBe(true);
    expect(validate(signupBodySchema, { name: 'A', email: 'a@b.co' })).toBe(false);
    expect(validate(signupBodySchema, { name: 'A', email: 'a@b.co', password: '12345678', isAdmin: true })).toBe(false);
  });

  it('signin rejeita extras', () => {
    expect(validate(signinBodySchema, { email: 'a@b.co', password: '12345678' })).toBe(true);
    expect(validate(signinBodySchema, { email: 'a@b.co', password: '12345678', name: 'x' })).toBe(false);
  });

  it('addContact exige nickname e recipientAccountId sem extras', () => {
    expect(validate(addContactBodySchema, { nickname: 'Bruno', recipientAccountId: 'acc-bruno' })).toBe(true);
    expect(validate(addContactBodySchema, { nickname: 'Bruno' })).toBe(false);
    expect(validate(addContactBodySchema, { nickname: 'Bruno', recipientAccountId: 'acc-bruno', ownerUserId: 'u' })).toBe(false);
  });

  it('Idempotency-Key valida padrão do contrato', () => {
    const h = (k: string) => ({ 'idempotency-key': k });
    expect(validate(idempotencyKeyHeaderSchema, h('alice-bruno-001'))).toBe(true);
    expect(validate(idempotencyKeyHeaderSchema, h('abc1234'))).toBe(false); // 7
    expect(validate(idempotencyKeyHeaderSchema, h('k'.repeat(129)))).toBe(false);
    expect(validate(idempotencyKeyHeaderSchema, h('bad/key'))).toBe(false);
    expect(validate(idempotencyKeyHeaderSchema, h('with space'))).toBe(false);
    expect(validate(idempotencyKeyHeaderSchema, {})).toBe(false);
  });

  it('querystring de listagem aceita limit/cursor e rejeita lixo', () => {
    expect(validate(listTransfersQuerystringSchema, {})).toBe(true);
    expect(validate(listTransfersQuerystringSchema, { limit: '20' })).toBe(true);
    expect(validate(listTransfersQuerystringSchema, { limit: '20', cursor: 'abc' })).toBe(true);
    expect(validate(listTransfersQuerystringSchema, { limit: 'abc' })).toBe(false);
    expect(validate(listTransfersQuerystringSchema, { limit: '20', other: 'x' })).toBe(false);
  });
});

describe('response schemas cobrem DTOs do contrato', () => {
  it('AuthResult descarta campos internos', () => {
    const v = ajv.compile(responseSchemas.authResult as never);
    const ok = {
      user: { id: 'u', name: 'N', email: 'a@b.co', createdAt: '2026-10-01T00:00:00.000Z' },
      account: { id: 'a', currency: 'BRL', balanceCents: 0 },
    };
    expect(v({ ...ok, passwordHash: 'x' })).toBe(false); // additionalProperties false
    expect(v(ok)).toBe(true);
  });

  it('Transfer DTO tem shape do contrato', () => {
    const v = ajv.compile(responseSchemas.transfer as never);
    expect(
      v({
        id: 't1', sourceAccountId: 'a', recipientAccountId: 'b', recipientName: 'B',
        amountCents: 100, currency: 'BRL', note: null, status: 'PENDING',
        failureCode: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      v({
        id: 't1', sourceAccountId: 'a', recipientAccountId: 'b', recipientName: 'B',
        amountCents: 100, currency: 'BRL', note: null, status: 'PENDING',
        failureCode: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
        sagaStep: 'CREATED',
      }),
    ).toBe(false);
  });

  it('existe schema para todos os DTOs', () => {
    for (const key of ['user', 'account', 'authResult', 'balance', 'recipient', 'contact', 'transfer', 'transferPage', 'apiError', 'contactList']) {
      expect(responseSchemas).toHaveProperty(key);
    }
  });
});
