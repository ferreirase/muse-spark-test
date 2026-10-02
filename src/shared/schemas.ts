export const signupBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "email", "password"],
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
  },
} as const;

export const signinBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "password"],
  properties: {
    email: { type: "string" },
    password: { type: "string" },
  },
} as const;

export const addContactBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["nickname", "recipientAccountId"],
  properties: {
    nickname: { type: "string" },
    recipientAccountId: { type: "string" },
  },
} as const;

export const requestTransferBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["recipientAccountId", "amountCents"],
  properties: {
    recipientAccountId: { type: "string" },
    amountCents: { type: "integer" },
    note: { type: ["string", "null"] },
  },
} as const;

export const accountIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["accountId"],
  properties: {
    accountId: { type: "string" },
  },
} as const;

export const transferIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string" },
  },
} as const;

export const transferQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string" },
    cursor: { type: "string" },
  },
} as const;

const errorDetailSchema = {
  type: "object",
  required: ["field", "message"],
  properties: {
    field: { type: "string" },
    message: { type: "string" },
  },
} as const;

const apiErrorSchema = {
  type: "object",
  required: ["error", "requestId"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "array", items: errorDetailSchema },
      },
    },
    requestId: { type: "string" },
  },
} as const;

const userSchema = {
  type: "object",
  required: ["id", "name", "email", "createdAt"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    createdAt: { type: "string" },
  },
} as const;

const accountSchema = {
  type: "object",
  required: ["id", "currency", "balanceCents"],
  properties: {
    id: { type: "string" },
    currency: { type: "string" },
    balanceCents: { type: "integer" },
  },
} as const;

export const authResultSchema = {
  type: "object",
  required: ["user", "account"],
  properties: {
    user: userSchema,
    account: accountSchema,
  },
} as const;

export const balanceSchema = {
  type: "object",
  required: ["accountId", "currency", "balanceCents", "updatedAt"],
  properties: {
    accountId: { type: "string" },
    currency: { type: "string" },
    balanceCents: { type: "integer" },
    updatedAt: { type: "string" },
  },
} as const;

export const recipientSchema = {
  type: "object",
  required: ["accountId", "name"],
  properties: {
    accountId: { type: "string" },
    name: { type: "string" },
  },
} as const;

export const contactSchema = {
  type: "object",
  required: [
    "id",
    "nickname",
    "recipientAccountId",
    "recipientName",
    "createdAt",
  ],
  properties: {
    id: { type: "string" },
    nickname: { type: "string" },
    recipientAccountId: { type: "string" },
    recipientName: { type: "string" },
    createdAt: { type: "string" },
  },
} as const;

export const contactListSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: contactSchema },
  },
} as const;

export const transferSchema = {
  type: "object",
  required: [
    "id",
    "sourceAccountId",
    "recipientAccountId",
    "recipientName",
    "amountCents",
    "currency",
    "note",
    "status",
    "failureCode",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string" },
    sourceAccountId: { type: "string" },
    recipientAccountId: { type: "string" },
    recipientName: { type: "string" },
    amountCents: { type: "integer" },
    currency: { type: "string" },
    note: { type: ["string", "null"] },
    status: { type: "string" },
    failureCode: { type: ["string", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
} as const;

export const transferPageSchema = {
  type: "object",
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array", items: transferSchema },
    nextCursor: { type: ["string", "null"] },
  },
} as const;

export const errorResponseSchema = apiErrorSchema;

export const healthSchema = {
  type: "object",
  required: ["status"],
  properties: { status: { type: "string" } },
} as const;

export const testFaultBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceAccountId", "idempotencyKey", "mode"],
  properties: {
    sourceAccountId: { type: "string" },
    idempotencyKey: { type: "string" },
    mode: { type: "string", enum: ["FAIL_CREDIT_ONCE", "PAUSE_AFTER_DEBIT"] },
  },
} as const;

export const testReleaseBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["transferId"],
  properties: { transferId: { type: "string" } },
} as const;

export const testFaultResultSchema = {
  type: "object",
  required: ["armed"],
  properties: { armed: { type: "boolean" } },
} as const;
