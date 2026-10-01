/**
 * JSON Schemas das rotas + opções Ajv do app.
 * Fastify por padrão usa coerceTypes:'array' e removeAdditional:true —
 * sobrescrevemos para validação estrita sem coerção (PRD §7).
 */

export const AJV_OPTIONS = {
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  allErrors: true,
} as const;

const IDEMPOTENCY_KEY_PATTERN = '^[A-Za-z0-9._:-]{8,128}$';

export const signupBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'email', 'password'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    email: { type: 'string', minLength: 1, maxLength: 254 },
    password: { type: 'string', minLength: 8, maxLength: 72 },
  },
} as const;

export const signinBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    password: { type: 'string', minLength: 8, maxLength: 72 },
  },
} as const;

export const addContactBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nickname', 'recipientAccountId'],
  properties: {
    nickname: { type: 'string', minLength: 1, maxLength: 60 },
    recipientAccountId: { type: 'string', minLength: 1 },
  },
} as const;

export const requestTransferBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recipientAccountId', 'amountCents'],
  properties: {
    recipientAccountId: { type: 'string', minLength: 1 },
    amountCents: { type: 'integer', minimum: 1, maximum: 100000000 },
    note: { type: ['string', 'null'], maxLength: 140 },
  },
} as const;

export const transferHeadersSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['idempotency-key'],
  properties: {
    'idempotency-key': { type: 'string', pattern: IDEMPOTENCY_KEY_PATTERN },
  },
} as const;

export const listTransfersQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
    cursor: { type: 'string', minLength: 1 },
  },
} as const;

export const recipientParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId'],
  properties: {
    accountId: { type: 'string', minLength: 1 },
  },
} as const;

export const transferParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

// --- Responses (serialização descarta campos internos) ---

const userSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'email', 'createdAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

const accountSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'currency', 'balanceCents'],
  properties: {
    id: { type: 'string' },
    currency: { type: 'string', const: 'BRL' },
    balanceCents: { type: 'integer' },
  },
} as const;

export const authResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['user', 'account'],
  properties: { user: userSchema, account: accountSchema },
} as const;

export const balanceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'currency', 'balanceCents', 'updatedAt'],
  properties: {
    accountId: { type: 'string' },
    currency: { type: 'string', const: 'BRL' },
    balanceCents: { type: 'integer' },
    updatedAt: { type: 'string' },
  },
} as const;

export const recipientSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'name'],
  properties: {
    accountId: { type: 'string' },
    name: { type: 'string' },
  },
} as const;

export const contactSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'nickname', 'recipientAccountId', 'recipientName', 'createdAt'],
  properties: {
    id: { type: 'string' },
    nickname: { type: 'string' },
    recipientAccountId: { type: 'string' },
    recipientName: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

export const contactsListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: contactSchema } },
} as const;

export const transferSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'sourceAccountId',
    'recipientAccountId',
    'recipientName',
    'amountCents',
    'currency',
    'note',
    'status',
    'failureCode',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string' },
    sourceAccountId: { type: 'string' },
    recipientAccountId: { type: 'string' },
    recipientName: { type: 'string' },
    amountCents: { type: 'integer' },
    currency: { type: 'string', const: 'BRL' },
    note: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
    failureCode: { type: ['string', 'null'], enum: ['INSUFFICIENT_FUNDS', 'CREDIT_FAILED', null] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

export const transferPageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: transferSchema },
    nextCursor: { type: ['string', 'null'] },
  },
} as const;

export const apiErrorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'requestId'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'message'],
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    requestId: { type: 'string' },
  },
} as const;
