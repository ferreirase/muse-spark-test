import * as AjvPkg from 'ajv';
import { describe, expect, it } from 'vitest';
import {
  AJV_OPTIONS,
  addContactBodySchema,
  requestTransferBodySchema,
  signinBodySchema,
  signupBodySchema,
  transferHeadersSchema,
} from './schemas.js';

// Valida com as MESMAS opções do app, sem servidor (fastify.inject proibido).
type AjvCtor = new (o: object) => { compile: (s: object) => (d: unknown) => boolean; errors?: Array<{ instancePath: string }> | null };
const AjvClass = (AjvPkg as unknown as { default: AjvCtor }).default;
const ajv = new AjvClass({ ...AJV_OPTIONS, strict: true });

describe('schemas de body', () => {
  it('transferência rejeita string numérica, float, extra prop e currency', () => {
    const validate = ajv.compile(requestTransferBodySchema);
    const base = { recipientAccountId: 'acc-bruno', amountCents: 100 };
    expect(validate(base)).toBe(true);
    expect(validate({ ...base, amountCents: '100' })).toBe(false);
    expect(validate({ ...base, amountCents: 10.5 })).toBe(false);
    expect(validate({ ...base, amountCents: 0 })).toBe(false);
    expect(validate({ ...base, amountCents: 100000001 })).toBe(false);
    expect(validate({ ...base, sourceAccountId: 'acc-x' })).toBe(false);
    expect(validate({ ...base, currency: 'BRL' })).toBe(false);
    expect(validate({ recipientAccountId: 'acc-bruno' })).toBe(false); // amountCents required
    // amountCents aponta o campo nos erros
    const v2 = ajv.compile(requestTransferBodySchema) as ((d: unknown) => boolean) & { errors?: Array<{ instancePath: string }> | null };
    v2({ ...base, amountCents: '100' });
    const paths: string[] = ((v2.errors ?? []) as Array<{ instancePath: string }>).map(
      (e: { instancePath: string }) => e.instancePath,
    );
    expect(paths.some((p: string) => p.includes('amountCents'))).toBe(true);
  });

  it('signup/signin/contato rejeitam extras e exigem required', () => {
    expect(ajv.compile(signupBodySchema)({ name: 'A', email: 'a@b.co', password: '12345678', balanceCents: 1 })).toBe(false);
    expect(ajv.compile(signupBodySchema)({ name: 'Al', email: 'a@b.co', password: '12345678' })).toBe(true);
    expect(ajv.compile(signinBodySchema)({ email: 'a@b.co' })).toBe(false);
    expect(
      ajv.compile(addContactBodySchema)({ nickname: 'B', recipientAccountId: 'x', extra: 1 }),
    ).toBe(false);
  });

  it('Idempotency-Key: pattern exato do contrato', () => {
    const validate = ajv.compile(transferHeadersSchema);
    expect(validate({ 'idempotency-key': 'alice-bruno-001' })).toBe(true);
    for (const bad of ['curta7c', 'a'.repeat(129), 'com/barra', 'com espaço', 'çãõ12345']) {
      expect(validate({ 'idempotency-key': bad })).toBe(false);
    }
    expect(validate({})).toBe(false); // required
  });
});
