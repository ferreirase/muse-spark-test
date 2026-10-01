// Placeholder mínimo de servidor; substituído pela task de buildApp.
import fastify from 'fastify';

const app = fastify({ logger: false });

app.get('/health', async () => ({ status: 'ok' }));

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '127.0.0.1' });
