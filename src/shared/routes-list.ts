/**
 * Lista canônica das rotas /v1 + /health, usada pelo openapi e pelo teste de cobertura.
 * Formato: [método, path].
 */
export const APP_ROUTES: Array<[string, string]> = [
  ['GET', '/health'],
  ['POST', '/v1/auth/signup'],
  ['POST', '/v1/auth/signin'],
  ['POST', '/v1/auth/signout'],
  ['GET', '/v1/me'],
  ['GET', '/v1/accounts/me/balance'],
  ['GET', '/v1/recipients/{accountId}'],
  ['GET', '/v1/contacts'],
  ['POST', '/v1/contacts'],
  ['POST', '/v1/transfers'],
  ['GET', '/v1/transfers/{id}'],
  ['GET', '/v1/transfers'],
];

export const TEST_ROUTES_DOC = '/__test/* (fora do openapi — ver docs/test-controls.md)';
