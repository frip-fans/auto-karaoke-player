import path from 'node:path';
import { createServer } from 'vite';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';
const { app, store } = await createApp(path.resolve(process.env.KARAOKE_LIBRARY || 'songs'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'mpa' });
app.use((req, _res, next) => { if (req.path === '/display') req.url = '/display.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''); next(); });
app.use(vite.middlewares);
const server = await listen(app, 8787);
console.log(`开发模式: ${serverUrl(server)}\n曲库: ${store.folder}`);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await closeServer(server); await vite.close(); await store.close(); }
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
