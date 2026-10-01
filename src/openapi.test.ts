import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API_ROUTES } from './http/api-routes.js';

const openapiPath = fileURLToPath(new URL('../openapi.json', import.meta.url));
const spec = JSON.parse(readFileSync(openapiPath, 'utf8')) as {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
};

describe('openapi.json', () => {
  it('é OpenAPI 3.1 parseável com info obrigatória', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
  });

  it('cobre todas as rotas da API (mesmos métodos e caminhos)', () => {
    for (const r of API_ROUTES) {
      const path = spec.paths[r.path];
      expect(path, `${r.method} ${r.path} presente`).toBeTruthy();
      expect(path![r.method.toLowerCase()], `${r.method} ${r.path} operação`).toBeTruthy();
    }
    // número exato: nada a mais nem a menos em /v1 e /health
    const specRoutes = Object.entries(spec.paths).flatMap(([p, ops]) =>
      Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => `${m.toUpperCase()} ${p}`),
    ).sort();
    const expected = API_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(specRoutes).toEqual(expected);
  });

  it('não expõe rotas de teste no openapi principal', () => {
    for (const p of Object.keys(spec.paths)) {
      expect(p.startsWith('/__test')).toBe(false);
    }
  });

  it('documenta cookie bank_session como securityScheme e aplica em rota privada', () => {
    const scheme = spec.components.securitySchemes.bankSession as { type: string; in: string; name: string };
    expect(scheme).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'bank_session' });
    const me = spec.paths['/v1/me']!.get as { security?: unknown[] };
    expect(Array.isArray(me.security)).toBe(true);
  });

  it('documenta Idempotency-Key com pattern do contrato em POST /v1/transfers', () => {
    const post = spec.paths['/v1/transfers']!.post as {
      parameters?: Array<{ name: string; required: boolean; schema?: { pattern?: string } }>;
    };
    const param = post.parameters?.find((p) => p.name === 'Idempotency-Key');
    expect(param?.required).toBe(true);
    expect(param?.schema?.pattern).toBe('^[A-Za-z0-9._:-]{8,128}$');
  });

  it('responde 202 e 200 (replay) no POST /v1/transfers', () => {
    const responses = Object.keys((spec.paths['/v1/transfers']!.post as { responses: Record<string, unknown> }).responses);
    expect(responses).toContain('202');
    expect(responses).toContain('200');
  });

  it('tem componentes DTO do contrato', () => {
    for (const name of ['User', 'Account', 'AuthResult', 'Balance', 'Recipient', 'Contact', 'Transfer', 'TransferPage', 'ApiError']) {
      expect(spec.components.schemas[name], `component ${name}`).toBeTruthy();
    }
  });

  it('erros documentam os códigos do contrato', () => {
    const signupResponses = Object.keys((spec.paths['/v1/auth/signup']!.post as { responses: Record<string, unknown> }).responses);
    expect(signupResponses).toEqual(expect.arrayContaining(['201', '400', '409']));
    const transferResponses = Object.keys((spec.paths['/v1/transfers']!.post as { responses: Record<string, unknown> }).responses);
    expect(transferResponses).toEqual(expect.arrayContaining(['200', '202', '400', '401', '404', '409', '422', '500']));
  });
});
