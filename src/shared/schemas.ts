// JSON Schemas das rotas (contrato §5/§6) — sem coerção, sem remover extras.

export const ajvOptions = {
  coerceTypes: false,
  removeAdditional: false,
  allErrors: true,
  useDefaults: false,
} as const;

const nonEmptyString = { type: 'string', minLength: 1 };

export const signupBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'email', 'password'],
  properties: {
    name: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
  },
} as const;

export const signinBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string' },
    password: { type: 'string' },
  },
} as const;

export const addContactBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nickname', 'recipientAccountId'],
  properties: {
    nickname: { type: 'string' },
    recipientAccountId: nonEmptyString,
  },
} as const;

export const requestTransferBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recipientAccountId', 'amountCents'],
  properties: {
    recipientAccountId: nonEmptyString,
    amountCents: { type: 'integer', minimum: 1, maximum: 100000000 },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

// Headers: valida apenas idempotency-key; outros headers do protocolo seguem.
export const idempotencyKeyHeaderSchema = {
  type: 'object',
  required: ['idempotency-key'],
  properties: {
    'idempotency-key': { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' },
  },
} as const;

export const listTransfersQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
    cursor: { type: 'string' },
  },
} as const;

// ---- Response schemas (serialização descarta campos internos) ----

const isoString = { type: 'string' };

const userSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'email', 'createdAt'],
  properties: { id: nonEmptyString, name: { type: 'string' }, email: { type: 'string' }, createdAt: isoString },
} as const;

const accountSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'currency', 'balanceCents'],
  properties: { id: nonEmptyString, currency: { type: 'string', enum: ['BRL'] }, balanceCents: { type: 'integer' } },
} as const;

const authResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['user', 'account'],
  properties: { user: userSchema, account: accountSchema },
} as const;

const balanceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'currency', 'balanceCents', 'updatedAt'],
  properties: {
    accountId: nonEmptyString,
    currency: { type: 'string', enum: ['BRL'] },
    balanceCents: { type: 'integer' },
    updatedAt: isoString,
  },
} as const;

const recipientSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'name'],
  properties: { accountId: nonEmptyString, name: { type: 'string' } },
} as const;

const contactSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'nickname', 'recipientAccountId', 'recipientName', 'createdAt'],
  properties: {
    id: nonEmptyString,
    nickname: { type: 'string' },
    recipientAccountId: nonEmptyString,
    recipientName: { type: 'string' },
    createdAt: isoString,
  },
} as const;

const transferSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'sourceAccountId', 'recipientAccountId', 'recipientName', 'amountCents',
    'currency', 'note', 'status', 'failureCode', 'createdAt', 'updatedAt',
  ],
  properties: {
    id: nonEmptyString,
    sourceAccountId: nonEmptyString,
    recipientAccountId: nonEmptyString,
    recipientName: { type: 'string' },
    amountCents: { type: 'integer' },
    currency: { type: 'string', enum: ['BRL'] },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
    failureCode: { anyOf: [{ type: 'string', enum: ['INSUFFICIENT_FUNDS', 'CREDIT_FAILED'] }, { type: 'null' }] },
    createdAt: isoString,
    updatedAt: isoString,
  },
} as const;

const transferPageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: transferSchema },
    nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const;

const apiErrorSchema = {
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
            properties: { field: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
    requestId: { type: 'string' },
  },
} as const;

const contactListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: contactSchema } },
} as const;

export const responseSchemas = {
  user: userSchema,
  account: accountSchema,
  authResult: authResultSchema,
  balance: balanceSchema,
  recipient: recipientSchema,
  contact: contactSchema,
  transfer: transferSchema,
  transferPage: transferPageSchema,
  apiError: apiErrorSchema,
  contactList: contactListSchema,
} as const;

export const healthSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['ok'] } },
} as const;
