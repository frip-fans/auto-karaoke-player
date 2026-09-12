import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createApp, listen, serverUrl, closeServer } from './app.js';

const { values } = parseArgs({ options: { library: { type: 'string' }, port: { type: 'string', default: '8787' }, 'no-browser': { type: 'boolean', default: false } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口必须在 0–65535 之间');
const { app, store } = await createApp(path.resolve(values.library || 'songs'), { webRoot: fileURLToPath(new URL('../web', import.meta.url)) });
const server = await listen(app, port);
const url = serverUrl(server);
console.log(`曲库: ${store.folder}\n打开: ${url}\nCtrl+C 关闭服务`);
if (!values['no-browser']) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore', windowsHide: true }).on('error', () => console.log('请在浏览器中打开上方地址。')).unref();
}
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await closeServer(server); await store.close(); }
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
