/** Rotas da API normal (contrato §6) — fonte única para openapi e testes. */
export interface ApiRoute {
  method: 'GET' | 'POST';
  path: string;
  private: boolean;
}

export const API_ROUTES: readonly ApiRoute[] = [
  { method: 'GET', path: '/health', private: false },
  { method: 'POST', path: '/v1/auth/signup', private: false },
  { method: 'POST', path: '/v1/auth/signin', private: false },
  { method: 'POST', path: '/v1/auth/signout', private: false },
  { method: 'GET', path: '/v1/me', private: true },
  { method: 'GET', path: '/v1/accounts/me/balance', private: true },
  { method: 'GET', path: '/v1/recipients/{accountId}', private: true },
  { method: 'GET', path: '/v1/contacts', private: true },
  { method: 'POST', path: '/v1/contacts', private: true },
  { method: 'POST', path: '/v1/transfers', private: true },
  { method: 'GET', path: '/v1/transfers', private: true },
  { method: 'GET', path: '/v1/transfers/{id}', private: true },
] as const;
