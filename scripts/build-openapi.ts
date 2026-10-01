// Gera openapi.json (OpenAPI 3.1) a partir dos schemas do código.
// Executar: npm run openapi
import { writeFileSync } from 'node:fs';
import { API_ROUTES } from '../src/http/api-routes.js';
import {
  responseSchemas,
  signupBodySchema,
  signinBodySchema,
  addContactBodySchema,
  requestTransferBodySchema,
  idempotencyKeyHeaderSchema,
  listTransfersQuerystringSchema,
} from '../src/shared/schemas.ts';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const jsonError = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('ApiError') } },
});

const setCookie = {
  description: 'Cookie de sessão `bank_session` (HttpOnly, SameSite=Lax, Path=/, 24 h).',
  schema: { type: 'string', example: 'bank_session=<token>; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax' },
};

const security = [{ bankSession: [] }];

const idempotencyParam = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: 'Chave de idempotência por conta remetente (8–128 chars ASCII).',
  schema: (idempotencyKeyHeaderSchema as { properties: Record<string, { type: string; pattern: string }> }).properties['idempotency-key'],
};

const spec: Record<string, unknown> = {
  openapi: '3.1.0',
  info: {
    title: 'Banco Demo v1 — API',
    version: '1.0.0',
    description: 'Backend do Banco Demo: signup/signin/signout, saldo, contatos e transferências simuladas (CQRS + Saga). Moeda BRL; valores em centavos inteiros.',
  },
  servers: [{ url: 'http://127.0.0.1:3001', description: 'Local' }],
  components: {
    securitySchemes: {
      bankSession: { type: 'apiKey', in: 'cookie', name: 'bank_session', description: 'Sessão opaca emitida em signup/signin (24 h, revogável por signout).' },
    },
    schemas: {
      User: responseSchemas.user,
      Account: responseSchemas.account,
      AuthResult: responseSchemas.authResult,
      Balance: responseSchemas.balance,
      Recipient: responseSchemas.recipient,
      Contact: responseSchemas.contact,
      ContactList: responseSchemas.contactList,
      Transfer: responseSchemas.transfer,
      TransferPage: responseSchemas.transferPage,
      ApiError: responseSchemas.apiError,
      SignupRequest: signupBodySchema,
      SigninRequest: signinBodySchema,
      AddContactRequest: addContactBodySchema,
      RequestTransferRequest: requestTransferBodySchema,
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Público. Retorna {"status":"ok"} quando app e SQLite estão prontos.',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } } } }, 503: jsonError('SQLite indisponível') },
      },
    },
    '/v1/auth/signup': {
      post: {
        summary: 'Criar conta',
        description: 'Cria usuário, conta BRL com saldo zero e sessão atomicamente.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('SignupRequest'), example: { name: 'Alice Demo', email: 'alice@demo.local', password: 'Demo123!' } } } },
        responses: {
          201: { description: 'Criado; cookie de sessão emitido', headers: { 'Set-Cookie': setCookie }, content: { 'application/json': { schema: ref('AuthResult') } } },
          400: jsonError('Corpo inválido (VALIDATION_ERROR com details)'),
          409: jsonError('E-mail já cadastrado (EMAIL_ALREADY_EXISTS)'),
          500: jsonError('Erro interno'),
        },
      },
    },
    '/v1/auth/signin': {
      post: {
        summary: 'Entrar',
        requestBody: { required: true, content: { 'application/json': { schema: ref('SigninRequest'), example: { email: 'alice@demo.local', password: 'Demo123!' } } } },
        responses: {
          200: { description: 'Autenticado; cookie emitido', headers: { 'Set-Cookie': setCookie }, content: { 'application/json': { schema: ref('AuthResult') } } },
          400: jsonError('Corpo inválido'),
          401: jsonError('Credenciais inválidas (INVALID_CREDENTIALS)'),
          500: jsonError('Erro interno'),
        },
      },
    },
    '/v1/auth/signout': {
      post: {
        summary: 'Sair (idempotente)',
        security,
        responses: {
          204: { description: 'Sessão revogada (se existir); cookie expirado', headers: { 'Set-Cookie': { ...setCookie, schema: { type: 'string', example: 'bank_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' } } } },
          500: jsonError('Erro interno'),
        },
      },
    },
    '/v1/me': {
      get: {
        summary: 'Usuário e conta autenticados',
        security,
        responses: { 200: { description: 'AuthResult', content: { 'application/json': { schema: ref('AuthResult') } } }, 401: jsonError('Sessão ausente/expirada/revogada (UNAUTHENTICATED)'), 500: jsonError('Erro interno') },
      },
    },
    '/v1/accounts/me/balance': {
      get: {
        summary: 'Saldo disponível',
        security,
        responses: { 200: { description: 'Saldo em centavos (inclui centavos exatos)', content: { 'application/json': { schema: ref('Balance') } } }, 401: jsonError('UNAUTHENTICATED'), 500: jsonError('Erro interno') },
      },
    },
    '/v1/recipients/{accountId}': {
      get: {
        summary: 'Consultar destinatário por ID exato',
        security,
        parameters: [{ name: 'accountId', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 128 } }],
        responses: { 200: { description: 'Só accountId e nome', content: { 'application/json': { schema: ref('Recipient') } } }, 401: jsonError('UNAUTHENTICATED'), 404: jsonError('Conta não encontrada (RECIPIENT_NOT_FOUND)'), 422: jsonError('Própria conta (SELF_RECIPIENT)'), 500: jsonError('Erro interno') },
      },
    },
    '/v1/contacts': {
      get: {
        summary: 'Listar contatos salvos',
        security,
        responses: { 200: { description: 'Ordenado por nickname e id', content: { 'application/json': { schema: ref('ContactList') } } }, 401: jsonError('UNAUTHENTICATED'), 500: jsonError('Erro interno') },
      },
      post: {
        summary: 'Salvar contato',
        security,
        requestBody: { required: true, content: { 'application/json': { schema: ref('AddContactRequest'), example: { nickname: 'Bruno', recipientAccountId: 'acc-bruno' } } } },
        responses: {
          201: { description: 'Contato criado', content: { 'application/json': { schema: ref('Contact') } } },
          400: jsonError('Corpo inválido'),
          401: jsonError('UNAUTHENTICATED'),
          404: jsonError('RECIPIENT_NOT_FOUND'),
          409: jsonError('CONTACT_ALREADY_EXISTS'),
          422: jsonError('SELF_RECIPIENT'),
          500: jsonError('Erro interno'),
        },
      },
    },
    '/v1/transfers': {
      post: {
        summary: 'Solicitar transferência',
        description: '202 novo pedido (PENDING) ou 200 replay da mesma chave+payload com o estado atual. Persistência e trabalho do worker são criados antes de responder. Saldo insuficiente não é erro HTTP: a Saga termina FAILED/INSUFFICIENT_FUNDS.',
        security,
        parameters: [idempotencyParam],
        requestBody: { required: true, content: { 'application/json': { schema: ref('RequestTransferRequest'), example: { recipientAccountId: 'acc-bruno', amountCents: 10000, note: 'Almoço' } } } },
        responses: {
          200: { description: 'Replay idempotente (mesmo id e estado atual)', content: { 'application/json': { schema: ref('Transfer') } } },
          202: { description: 'Aceito; status inicial PENDING', content: { 'application/json': { schema: ref('Transfer') } } },
          400: jsonError('Validação (inclui Idempotency-Key inválida, campo idempotency-key)'),
          401: jsonError('UNAUTHENTICATED'),
          404: jsonError('RECIPIENT_NOT_FOUND'),
          409: jsonError('Chave com payload diferente (IDEMPOTENCY_CONFLICT)'),
          422: jsonError('SELF_TRANSFER'),
          500: jsonError('Erro interno'),
        },
      },
      get: {
        summary: 'Histórico paginado (só envios do autenticado)',
        security,
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: (listTransfersQuerystringSchema as { properties: Record<string, unknown> }).properties.limit, description: 'Inteiro 1–50 (default 20)' },
          { name: 'cursor', in: 'query', required: false, schema: (listTransfersQuerystringSchema as { properties: Record<string, unknown> }).properties.cursor, description: 'Cursor opaco da página anterior' },
        ],
        responses: { 200: { description: 'Ordem createdAt desc, id desc; sem duplicatas ou lacunas', content: { 'application/json': { schema: ref('TransferPage') } } }, 400: jsonError('VALIDATION_ERROR (limit/cursor)'), 401: jsonError('UNAUTHENTICATED'), 500: jsonError('Erro interno') },
      },
    },
    '/v1/transfers/{id}': {
      get: {
        summary: 'Detalhe de transferência enviada',
        security,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 128 } }],
        responses: { 200: { description: 'Transfer com status público e failureCode', content: { 'application/json': { schema: ref('Transfer') } } }, 401: jsonError('UNAUTHENTICATED'), 404: jsonError('TRANSFER_NOT_FOUND (inclusive IDs de outros usuários)'), 500: jsonError('Erro interno') },
      },
    },
  },
};

// consistência com a lista única de rotas
const specRoutes = Object.entries(spec.paths as Record<string, Record<string, unknown>>)
  .flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`))
  .sort();
const expected = API_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
if (JSON.stringify(specRoutes) !== JSON.stringify(expected)) {
  console.error('Rotas divergem de API_ROUTES:', { specRoutes, expected });
  process.exit(1);
}

writeFileSync(new URL('../openapi.json', import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);
console.log('openapi.json gerado com', specRoutes.length, 'operações');
