import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const exec = promisify(execFile);
export async function fixture(file: string, second = 'Vocals', delay = false, duration = 4, moving = false) {
  await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', moving ? `testsrc2=s=320x180:r=24:d=${duration}` : `color=c=navy:s=320x180:r=24:d=${duration}`, '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${duration}`, ...(delay ? ['-itsoffset', '0.5'] : []), '-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=44100:duration=${duration}`, '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata:s:a:0', 'handler_name=Instrumental', '-metadata:s:a:1', 'handler_name=' + second, file]);
}
export async function until<T>(fn: () => Promise<T>, accept: (value: T) => boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (accept(value)) return value; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Timed out waiting for media preparation');
}
