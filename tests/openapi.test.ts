import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from '../src/shared/routes-list.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('openapi.json', () => {
  it('cobre todas as rotas /v1 + health e nenhuma /__test', () => {
    const spec = JSON.parse(readFileSync(join(root, 'openapi.json'), 'utf8')) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
    };
    expect(spec.openapi.startsWith('3.1.')).toBe(true);
    const documented = new Set<string>();
    for (const [path, item] of Object.entries(spec.paths)) {
      expect(path.startsWith('/__test')).toBe(false);
      for (const method of Object.keys(item)) documented.add(`${method.toUpperCase()} ${path}`);
    }
    for (const [m, p] of APP_ROUTES) {
      expect(documented.has(`${m} ${p}`), `falta ${m} ${p}`).toBe(true);
    }
    // Cookie + Idempotency-Key documentados.
    expect(spec.components.securitySchemes['bankSession']).toMatchObject({ in: 'cookie', name: 'bank_session' });
    const post = (spec.paths['/v1/transfers'] as Record<string, { parameters?: Array<{ name: string }> }>)['post'];
    expect(post.parameters?.some((p) => p.name === 'Idempotency-Key')).toBe(true);
    // DTOs do contrato presentes.
    for (const s of ['AuthResult', 'Balance', 'Recipient', 'Contact', 'Transfer', 'TransferPage', 'ApiError']) {
      expect(spec.components.schemas[s], `falta schema ${s}`).toBeDefined();
    }
  });
});
