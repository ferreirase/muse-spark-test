import type { FastifyInstance } from 'fastify';

/** Cache-Control: no-store em toda rota /v1/* e /__test/* (autenticadas/financeiras). */
export function noStorePlugin(app: FastifyInstance): void {
  void app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/v1/') || req.url.startsWith('/__test/')) {
      void reply.header('Cache-Control', 'no-store');
    }
  });
}
