import express from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { MediaTools } from './media.js';
import { LibraryStore } from './library.js';

export async function createApp(folder: string, options: { webRoot?: string; media?: MediaTools } = {}) {
  await mkdir(folder, { recursive: true });
  const media = options.media || new MediaTools();
  await media.check();
  const store = new LibraryStore(await realpath(folder), media);
  await store.init();
  const app = express(), token = randomBytes(32).toString('base64url');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) { res.sendStatus(403); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.get('X-Karaoke-Token') !== token || (req.get('Origin') && req.get('Origin') !== `${req.protocol}://${req.get('host')}`))) { res.sendStatus(403); return; }
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const library = async () => ({ token, library_id: store.db.library_id, folder: store.folder, album_order: store.db.album_order || [], songs: await Promise.all(store.db.songs.map(s => store.public(s))) });
  app.get('/api/library', async (_req, res) => { res.json(await library()); });
  app.post('/api/library/albums/order', async (req, res) => { await store.reorderAlbums(req.body?.albums); res.json(await library()); });
  app.post('/api/library/order', async (req, res) => { await store.reorder(req.body?.album, req.body?.song_ids); res.json(await library()); });
  app.post('/api/scan', async (_req, res) => { await store.scan(); res.json(await library()); });
  app.post('/api/songs/:id/match', async (req, res) => { res.json(await store.applyMatch(req.params.id, req.body)); });
  const upload = multer({ dest: store.cache, limits: { fileSize: 16 * 1024 ** 3, files: 100, fields: 10 } });
  app.post('/api/import', upload.array('files'), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) throw new Error('请选择 MP4 文件');
    const songs = [], errors = [];
    try {
      for (const file of files) {
        // Multipart browser filenames are UTF-8 bytes; Multer decodes header parameters as Latin-1.
        const filename = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8').replaceAll('\\', '/'));
        if (path.extname(filename).toLowerCase() !== '.mp4') { errors.push(`${filename}: 只接受 MP4`); continue; }
        try { songs.push(await store.importFile(file.path, filename, req.body)); }
        catch { errors.push(`${filename}: 无法读取或保存 MP4`); }
      }
    } finally { await Promise.all(files.map(f => rm(f.path, { force: true }))); }
    res.json({ songs, errors });
  });
  app.patch('/api/songs/:id', async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('无效的歌曲信息');
    res.json(await store.edit(req.params.id, req.body));
  });
  app.route('/api/songs/:id/prepare')
    .get(async (req, res) => { res.json(await store.preparation(req.params.id, false)); })
    .post(async (req, res) => { res.json(await store.preparation(req.params.id, true)); });
  app.get('/video/:id', async (req, res) => { res.sendFile(await store.source(store.lookup(req.params.id)), { dotfiles: 'allow' }); });
  app.get('/audio/:key/:name', (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.key) || store.jobs.get(req.params.key)?.status !== 'ready' || !['instrumental.wav', 'vocals.wav'].includes(req.params.name)) { res.sendStatus(404); return; }
    res.sendFile(path.join(store.cache, req.params.key, req.params.name), { dotfiles: 'allow' });
  });
  if (options.webRoot) {
    app.get('/display', (_req, res) => { res.sendFile(path.join(options.webRoot!, 'display.html')); });
    app.use(express.static(options.webRoot));
  }
  app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    const status = err instanceof multer.MulterError ? 413 : err.status || (err.code === 'ENOENT' ? 404 : 400);
    res.status(status).json({ error: err.message.slice(0, 400) });
  });
  return { app, store };
}

export async function listen(app: express.Express, port = 0): Promise<Server> {
  // Express 5 invokes its listen callback on both success and error. Resolve
  // only on the native server's listening event, preserving bind errors.
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    const cleanup = () => { server.off('error', failed); server.off('listening', started); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const started = () => { cleanup(); resolve(server); };
    server.once('error', failed); server.once('listening', started);
    try { server.listen(port, '127.0.0.1'); } catch (error) { cleanup(); reject(error); }
  });
}
export async function listenAvailable(app: express.Express, preferredPort = 8787) {
  try { return await listen(app, preferredPort); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    return listen(app, 0);
  }
}
export function serverPort(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') throw Object.assign(new Error('本地服务尚未成功监听或已经关闭'), { code: 'ERR_SERVER_NOT_LISTENING' });
  return address.port;
}
export function serverUrl(server: Server) { return `http://127.0.0.1:${serverPort(server)}`; }
export async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => { server.close(err => err ? reject(err) : resolve()); server.closeAllConnections(); });
}
