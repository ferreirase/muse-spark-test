export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'RECIPIENT_NOT_FOUND'
  | 'TRANSFER_NOT_FOUND'
  | 'EMAIL_ALREADY_EXISTS'
  | 'CONTACT_ALREADY_EXISTS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SELF_RECIPIENT'
  | 'SELF_TRANSFER'
  | 'INTERNAL_ERROR'
  | 'TEST_CONTROLS_DISABLED'
  | 'TEST_CONTROLS_FORBIDDEN';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
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
    if (details !== undefined) this.details = details;
  }
}

export function validationError(details: ErrorDetail[], message = 'Dados inválidos'): AppError {
  return new AppError('VALIDATION_ERROR', 400, message, details);
}

export function unauthenticated(message = 'Sessão ausente, expirada ou revogada'): AppError {
  return new AppError('UNAUTHENTICATED', 401, message);
}

export function invalidCredentials(message = 'E-mail ou senha inválidos'): AppError {
  return new AppError('INVALID_CREDENTIALS', 401, message);
}

export function originNotAllowed(message = 'Origem não permitida'): AppError {
  return new AppError('ORIGIN_NOT_ALLOWED', 403, message);
}

export function conflict(code: ErrorCode, message: string): AppError {
  return new AppError(code, 409, message);
}

export function unprocessable(code: ErrorCode, message: string): AppError {
  return new AppError(code, 422, message);
}

interface AjvLikeError {
  instancePath?: string;
  schemaPath?: string;
  keyword?: string;
  params?: Record<string, unknown>;
  message?: string;
}

interface FastifyValidationLike {
  validation?: AjvLikeError[];
  validationContext?: string;
  code?: string;
  statusCode?: number;
  message?: string;
}

function contextPrefix(context: string | undefined): string {
  switch (context) {
    case 'body':
      return '';
    case 'querystring':
      return 'query.';
    case 'params':
      return 'params.';
    case 'headers':
      return 'headers.';
    default:
      return '';
  }
}

function fieldFromAjvError(err: AjvLikeError, context: string | undefined): string {
  const path = (err.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.');
  if (path) {
    if (context === 'headers' && path.toLowerCase() === 'idempotency-key') return 'idempotency-key';
    return `${contextPrefix(context)}${path}`;
  }
  const params = err.params ?? {};
  if (typeof params['missingProperty'] === 'string') {
    return `${contextPrefix(context)}${params['missingProperty'] as string}`;
  }
  if (typeof params['additionalProperty'] === 'string') {
    return `${contextPrefix(context)}${params['additionalProperty'] as string}`;
  }
  if (typeof params['propertyName'] === 'string') {
    return `${contextPrefix(context)}${params['propertyName'] as string}`;
  }
  return contextPrefix(context).replace(/\.$/, '') || 'body';
}

/** Converte erro Ajv/Fastify em details de VALIDATION_ERROR. Função pura. */
export function ajvErrorsToDetails(
  validation: AjvLikeError[],
  context: string | undefined,
): ErrorDetail[] {
  return validation.map((e) => ({
    field: fieldFromAjvError(e, context),
    message: e.message ?? 'valor inválido',
  }));
}

function isFastifyValidationError(err: unknown): err is FastifyValidationLike & { validation: AjvLikeError[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    Array.isArray((err as { validation?: unknown }).validation)
  );
}

function isBadJsonError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return (
    code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
    code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
  );
}

/**
 * Converte qualquer erro no par {statusCode, body} do DTO ApiError.
 * Erros desconhecidos (incl. SQLite) viram 500 genérico sem vazar detalhes.
 */
export function toApiErrorResponse(
  err: unknown,
  requestId: string,
): { statusCode: number; body: ApiErrorBody } {
  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message },
      requestId,
    };
    if (err.details !== undefined) body.error.details = err.details;
    return { statusCode: err.statusCode, body };
  }
  if (isFastifyValidationError(err)) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: ajvErrorsToDetails(err.validation, err.validationContext),
        },
        requestId,
      },
    };
  }
  if (isBadJsonError(err)) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Corpo JSON inválido',
          details: [{ field: 'body', message: 'corpo JSON inválido ou ausente' }],
        },
        requestId,
      },
    };
  }
  return {
    statusCode: 500,
    body: {
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
      requestId,
    },
  };
}
