import type { FastifyInstance } from 'fastify';

/** Cache-Control: no-store em rotas autenticadas/financeiras e de teste. */
export function registerNoStorePlugin(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/v1') || request.url.startsWith('/__test')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });
}
