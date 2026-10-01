/**
 * Gera openapi.json a partir dos schemas de src/shared/schemas.ts.
 * Uso: npx tsx scripts/build-openapi.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addContactBodySchema,
  apiErrorSchema,
  authResultSchema,
  balanceSchema,
  contactSchema,
  contactsListSchema,
  listTransfersQuerySchema,
  recipientParamsSchema,
  recipientSchema,
  requestTransferBodySchema,
  signinBodySchema,
  signupBodySchema,
  transferHeadersSchema,
  transferPageSchema,
  transferParamsSchema,
  transferSchema,
} from '../src/shared/schemas.js';
import { APP_ROUTES } from '../src/shared/routes-list.js';

const IDEMPOTENCY_DESC =
  'Obrigatório. 8–128 chars [A-Za-z0-9._:-]. Escopo por conta remetente, sem expiração. Replay com mesmo payload → 200 + mesma operação; payload diferente → 409.';

const errRef = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
});

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Banco Demo API',
    version: '1.0.0',
    description:
      'Backend bancário demo (contrato-compartilhado v1.0). Sessão por cookie bank_session. Transferências assíncronas via Saga: POST → PENDING/PROCESSING → GET → COMPLETED/FAILED.',
  },
  servers: [{ url: 'http://127.0.0.1:3001', description: 'Backend local' }],
  paths: {
    '/health': {
      get: {
        summary: 'Saúde do app + SQLite',
        security: [],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', const: 'ok' } }, required: ['status'] } } } },
          '503': errRef('SQLite indisponível'),
        },
      },
    },
    '/v1/auth/signup': {
      post: {
        summary: 'Cadastrar usuário + conta + sessão',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SignupBody' } } } },
        responses: {
          '201': {
            description: 'Criado + cookie bank_session (Set-Cookie)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResult' } } },
            headers: { 'Set-Cookie': { description: 'bank_session HttpOnly;SameSite=Lax;Path=/;Max-Age=86400', schema: { type: 'string' } } },
          },
          '400': errRef('VALIDATION_ERROR'),
          '403': errRef('ORIGIN_NOT_ALLOWED'),
          '409': errRef('EMAIL_ALREADY_EXISTS'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/auth/signin': {
      post: {
        summary: 'Entrar (cria sessão)',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SigninBody' } } } },
        responses: {
          '200': {
            description: 'OK + cookie bank_session',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResult' } } },
            headers: { 'Set-Cookie': { description: 'bank_session', schema: { type: 'string' } } },
          },
          '400': errRef('VALIDATION_ERROR'),
          '401': errRef('INVALID_CREDENTIALS'),
          '403': errRef('ORIGIN_NOT_ALLOWED'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/auth/signout': {
      post: {
        summary: 'Sair (idempotente, sempre 204)',
        requestBody: { required: false, description: 'Sem corpo; Content-Type json com corpo vazio é aceito.' },
        responses: {
          '204': { description: 'Saiu + cookie expirado' },
          '403': errRef('ORIGIN_NOT_ALLOWED'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/me': {
      get: {
        summary: 'Usuário + conta autenticados',
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResult' } } } },
          '401': errRef('UNAUTHENTICATED'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/accounts/me/balance': {
      get: {
        summary: 'Saldo disponível da conta',
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Balance' } } } },
          '401': errRef('UNAUTHENTICATED'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/recipients/{accountId}': {
      get: {
        summary: 'Consultar destinatário (só nome + ID)',
        parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Recipient' } } } },
          '401': errRef('UNAUTHENTICATED'),
          '404': errRef('RECIPIENT_NOT_FOUND'),
          '422': errRef('SELF_RECIPIENT'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/contacts': {
      get: {
        summary: 'Listar contatos (nickname, id)',
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContactsList' } } } },
          '401': errRef('UNAUTHENTICATED'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
      post: {
        summary: 'Salvar contato',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AddContactBody' } } } },
        responses: {
          '201': { description: 'Criado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } },
          '400': errRef('VALIDATION_ERROR'),
          '401': errRef('UNAUTHENTICATED'),
          '403': errRef('ORIGIN_NOT_ALLOWED'),
          '404': errRef('RECIPIENT_NOT_FOUND'),
          '409': errRef('CONTACT_ALREADY_EXISTS'),
          '422': errRef('SELF_RECIPIENT'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/transfers': {
      post: {
        summary: 'Solicitar transferência (202 novo, 200 replay)',
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, description: IDEMPOTENCY_DESC, schema: (transferHeadersSchema.properties as Record<string, unknown>)['idempotency-key'] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RequestTransferBody' } } } },
        responses: {
          '202': { description: 'Aceita (PENDING)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transfer' } } } },
          '200': { description: 'Replay idempotente (mesmo ID, estado atual)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transfer' } } } },
          '400': errRef('VALIDATION_ERROR'),
          '401': errRef('UNAUTHENTICATED'),
          '403': errRef('ORIGIN_NOT_ALLOWED'),
          '404': errRef('RECIPIENT_NOT_FOUND'),
          '409': errRef('IDEMPOTENCY_CONFLICT'),
          '422': errRef('SELF_TRANSFER'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
      get: {
        summary: 'Histórico paginado (só enviadas)',
        parameters: [
          { name: 'limit', in: 'query', required: false, description: 'Inteiro 1–50, default 20', schema: { type: 'string', pattern: '^[0-9]{1,3}$', default: '20' } },
          { name: 'cursor', in: 'query', required: false, description: 'Cursor opaco da página anterior', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/TransferPage' } } } },
          '400': errRef('VALIDATION_ERROR (limit/cursor)'),
          '401': errRef('UNAUTHENTICATED'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
    '/v1/transfers/{id}': {
      get: {
        summary: 'Detalhe da transferência (só enviadas)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transfer' } } } },
          '401': errRef('UNAUTHENTICATED'),
          '404': errRef('TRANSFER_NOT_FOUND'),
          '500': errRef('INTERNAL_ERROR'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bankSession: { type: 'apiKey', in: 'cookie', name: 'bank_session', description: 'Sessão opaca HttpOnly, 24h. Signup/signin emitem Set-Cookie; signout expira.' },
    },
    schemas: {
      User: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'email', 'createdAt'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Account: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'currency', 'balanceCents'],
        properties: {
          id: { type: 'string' },
          currency: { type: 'string', const: 'BRL' },
          balanceCents: { type: 'integer' },
        },
      },
      AuthResult: authResultSchema,
      Balance: balanceSchema,
      Recipient: recipientSchema,
      Contact: contactSchema,
      ContactsList: contactsListSchema,
      Transfer: transferSchema,
      TransferPage: transferPageSchema,
      ApiError: apiErrorSchema,
      SignupBody: signupBodySchema,
      SigninBody: signinBodySchema,
      AddContactBody: addContactBodySchema,
      RequestTransferBody: requestTransferBodySchema,
      RecipientParams: recipientParamsSchema,
      TransferParams: transferParamsSchema,
      ListTransfersQuery: listTransfersQuerySchema,
    },
  },
  security: [{ bankSession: [] }],
} as const;

// Sanidade: todas as rotas canônicas cobertas.
const documented = new Set<string>();
for (const [path, item] of Object.entries(openapi.paths)) {
  for (const method of Object.keys(item as Record<string, unknown>)) {
    documented.add(`${method.toUpperCase()} ${path}`);
  }
}
const missing = APP_ROUTES.filter(([m, p]) => !documented.has(`${m} ${p}`));
if (missing.length > 0) {
  console.error(`Rotas sem documentação: ${JSON.stringify(missing)}`);
  process.exit(1);
}

const root = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(root, '..', 'openapi.json'), `${JSON.stringify(openapi, null, 2)}\n`);
console.log(`openapi.json escrito com ${documented.size} operações.`);
