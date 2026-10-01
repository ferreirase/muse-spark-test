export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ORIGIN_NOT_ALLOWED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RECIPIENT_NOT_FOUND'
  | 'TRANSFER_NOT_FOUND'
  | 'EMAIL_ALREADY_EXISTS'
  | 'CONTACT_ALREADY_EXISTS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SELF_RECIPIENT'
  | 'SELF_TRANSFER'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: ErrorDetail[] };
  requestId: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, statusCode: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const errors = {
  validation: (details: ErrorDetail[]) =>
    new AppError('VALIDATION_ERROR', 400, 'Dados inválidos.', details),
  unauthenticated: () => new AppError('UNAUTHENTICATED', 401, 'Sessão ausente, expirada ou revogada.'),
  invalidCredentials: () => new AppError('INVALID_CREDENTIALS', 401, 'E-mail ou senha inválidos.'),
  originNotAllowed: () => new AppError('ORIGIN_NOT_ALLOWED', 403, 'Origem não permitida.'),
  notFound: (code: ErrorCode = 'NOT_FOUND') => new AppError(code, 404, 'Recurso não encontrado.'),
  recipientNotFound: () => new AppError('RECIPIENT_NOT_FOUND', 404, 'Conta destinatária não encontrada.'),
  transferNotFound: () => new AppError('TRANSFER_NOT_FOUND', 404, 'Transferência não encontrada.'),
  emailExists: () => new AppError('EMAIL_ALREADY_EXISTS', 409, 'E-mail já cadastrado.'),
  contactExists: () => new AppError('CONTACT_ALREADY_EXISTS', 409, 'Contato já salvo.'),
  idempotencyConflict: () =>
    new AppError('IDEMPOTENCY_CONFLICT', 409, 'Chave de idempotência já usada com payload diferente.'),
  selfRecipient: () => new AppError('SELF_RECIPIENT', 422, 'Não é possível usar a própria conta como destinatário.'),
  selfTransfer: () => new AppError('SELF_TRANSFER', 422, 'Não é possível transferir para a própria conta.'),
  internal: () => new AppError('INTERNAL_ERROR', 500, 'Erro interno. Tente novamente.'),
};

interface AjvLike {
  message?: string;
  instancePath?: string;
  keyword?: string;
  params?: Record<string, unknown>;
}

function fieldFromAjvError(e: AjvLike): string {
  const params = e.params ?? {};
  if (typeof params.missingProperty === 'string') return params.missingProperty;
  if (typeof params.additionalProperty === 'string') return params.additionalProperty;
  const path = (e.instancePath ?? '').replace(/^\//, '');
  return path.length > 0 ? path : 'body';
}

function isFastifyValidationError(err: unknown): err is { validationContext?: string; validation: AjvLike[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    Array.isArray((err as { validation?: unknown }).validation)
  );
}

function isContentTypeError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('FST_ERR_CTP')
  );
}

/**
 * Converte qualquer erro (domínio, validação Ajv/Fastify, JSON inválido,
 * desconhecido) em { statusCode, body } no formato ApiError do contrato.
 * Função pura — sem acesso a request/response.
 */
export function toApiErrorResponse(err: unknown, requestId: string): { statusCode: number; body: ApiErrorBody } {
  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message },
      requestId,
    };
    if (err.details && err.details.length > 0) body.error.details = err.details;
    return { statusCode: err.statusCode, body };
  }

  if (isFastifyValidationError(err)) {
    const details = err.validation.map((e) => ({
      field: fieldFromAjvError(e),
      message: e.message ?? 'Valor inválido',
    }));
    return {
      statusCode: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details }, requestId },
    };
  }

  if (isContentTypeError(err) || (err as { statusCode?: unknown })?.statusCode === 400) {
    return {
      statusCode: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.' }, requestId },
    };
  }

  // Desconhecido (inclui erros SQLite): mensagem genérica, sem vazar detalhes.
  return {
    statusCode: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' }, requestId },
  };
}
