import Fastify from 'fastify';
import cookie from '@fastify/cookie';

const app = Fastify({ logger: false });

app.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id);
});

app.addHook('onRequest', async (request) => {
  const origin = request.headers.origin;
  const safe = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (!safe.has(request.method.toUpperCase()) && origin !== undefined && origin !== '' && origin !== 'http://127.0.0.1:3000') {
    throw new Error('ORIGIN');
  }
});

app.addHook('onSend', async (request, reply) => {
  if (request.url.startsWith('/v1')) reply.header('Cache-Control', 'no-store');
  return reply;
});

await app.register(cookie);

app.setErrorHandler((err, _req, reply) => {
  reply.code(500).send({ error: { code: 'X', message: String(err.message) } });
});

app.get('/health', async () => {
  try {
    // select fake
    return { status: 'ok' };
  } catch {
    return { status: 'err' };
  }
});

await app.listen({ port: 3998, host: '127.0.0.1' });
console.log('up');
