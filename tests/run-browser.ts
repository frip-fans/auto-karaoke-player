import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';
import { fixture, exec } from './fixtures.js';
const root = await mkdtemp(path.join(os.tmpdir(), 'karaoke-browser-'));
try {
  await fixture(path.join(root, 'Synthetic.mp4'));
  const { app, store } = await createApp(root, { webRoot: path.resolve('dist/web') });
  await store.scan();
  const server = await listen(app);
  try { const result = await exec(process.execPath, ['tests/browser.cjs'], { env: { ...process.env, KARAOKE_TEST_URL: serverUrl(server), KARAOKE_TEST_MEDIA_FILE: path.join(root, 'Synthetic.mp4') }, timeout: 90000 }); console.log(result.stdout); }
  finally { await closeServer(server); await store.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
