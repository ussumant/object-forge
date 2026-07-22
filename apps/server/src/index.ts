import { createApp } from './app.js';

const port = Number(process.env.IMG3D_PORT ?? 4057);
const host = process.env.IMG3D_HOST ?? '127.0.0.1';
const app = await createApp();

await app.listen({ port, host });

const close = async () => {
  await app.close();
  process.exit(0);
};

process.on('SIGINT', close);
process.on('SIGTERM', close);
