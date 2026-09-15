import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

// Pin upstream releases and verify the downloaded bytes before extracting/executing.
const macArm64 = {
  ffmpeg: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
  ffprobe: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be',
  LICENSE: 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2',
  README: '05ba4b92c96605434b1aaae3eedf5a2c280c9607bf78ffca9a5b536d9af2dc6a',
};
const target = `${process.platform}-${process.arch}`;
if (target !== 'darwin-arm64' && target !== 'win32-x64') {
  throw new Error(`Unsupported media-tools target: ${target}`);
}
const output = path.resolve('media-tools');
const temp = await mkdtemp(path.join(os.tmpdir(), 'karaoke-media-'));
const sources = [];
async function download(url, sha256) {
  const file = path.join(temp, path.basename(url));
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(response.body, createWriteStream(file));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== sha256) throw new Error(`SHA-256 mismatch: ${url}`);
  sources.push(`${url}\nSHA-256: ${sha256}`);
  return file;
}
try {
  await mkdir(output, { recursive: true });
  if (process.platform === 'darwin') {
    const base = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';
    for (const name of ['ffmpeg', 'ffprobe']) {
      const archive = await download(`${base}/${name}-${target}.gz`, macArm64[name]);
      await pipeline(createReadStream(archive), createGunzip(), createWriteStream(path.join(output, name)));
      await chmod(path.join(output, name), 0o755);
    }
    for (const name of ['LICENSE', 'README']) {
      await copyFile(await download(`${base}/${target}.${name}`, macArm64[name]), path.join(output, name));
    }
  } else {
    const archive = await download('https://github.com/GyanD/codexffmpeg/releases/download/9.0.1/ffmpeg-9.0.1-essentials_build.zip', 'fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9');
    const extracted = path.join(temp, 'extracted');
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:KARAOKE_ARCHIVE -DestinationPath $env:KARAOKE_EXTRACTED'], {
      env: { ...process.env, KARAOKE_ARCHIVE: archive, KARAOKE_EXTRACTED: extracted }, stdio: 'inherit',
    });
    const entries = await readdir(extracted, { withFileTypes: true });
    const root = entries.find(entry => entry.isDirectory() && entry.name.startsWith('ffmpeg-'));
    if (!root) throw new Error('Missing FFmpeg directory in upstream archive');
    const source = path.join(extracted, root.name);
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) await copyFile(path.join(source, 'bin', name), path.join(output, name));
    for (const name of ['LICENSE', 'README.txt']) await copyFile(path.join(source, name), path.join(output, name));
  }
  await writeFile(path.join(output, 'SOURCES.txt'), sources.join('\n\n') + '\n');
  for (const name of ['ffmpeg', 'ffprobe']) {
    execFileSync(path.join(output, name + (process.platform === 'win32' ? '.exe' : '')), ['-version'], { stdio: 'inherit' });
  }
  if (process.env.GITHUB_ENV) {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    await appendFile(process.env.GITHUB_ENV, `KARAOKE_MEDIA_TOOLS_DIR=${output}\nFFMPEG_PATH=${path.join(output, 'ffmpeg' + suffix)}\nFFPROBE_PATH=${path.join(output, 'ffprobe' + suffix)}\n`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
