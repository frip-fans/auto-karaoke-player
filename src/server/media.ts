import { spawn, type ChildProcess } from 'node:child_process';
import type { Track } from '../shared/types.js';

export class MediaTools {
  private children = new Set<ChildProcess>();
  private stopped = false;
  constructor(readonly ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', readonly ffprobe = process.env.FFPROBE_PATH || 'ffprobe') {}
  run(program: string, args: string[]): Promise<string> {
    if (this.stopped) return Promise.reject(new Error('服务已关闭'));
    return new Promise((resolve, reject) => {
      const child = spawn(program, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.children.add(child);
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 8 * 1024 * 1024) child.kill(); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.once('error', reject);
      child.once('close', code => { this.children.delete(child); code === 0 ? resolve(stdout) : reject(new Error(stderr || `${program} 执行失败 (${code})`)); });
    });
  }
  async check() { await this.run(this.ffmpeg, ['-version']); await this.run(this.ffprobe, ['-version']); }
  async probe(path: string) {
    const data = JSON.parse(await this.run(this.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])) as {
      streams: { index: number; codec_type: string; codec_name: string; tags?: Record<string, string> }[];
      format: { duration: string };
    };
    const video = data.streams.find(s => s.codec_type === 'video');
    if (!video) throw new Error('文件没有视频轨道');
    const tracks: Track[] = data.streams.filter(s => s.codec_type === 'audio').map(s => {
      const name = (s.tags?.title || s.tags?.handler_name || '').trim(), normalized = name.toLowerCase();
      return { index: s.index, name: name || '未标记音轨', role: ['vocals', 'vocal', 'vocal only', 'isolated vocals'].includes(normalized) ? 'vocals' : ['instrumental', '伴奏'].includes(normalized) ? 'instrumental' : 'unknown' };
    });
    if (!tracks.length) throw new Error('文件没有音轨');
    const duration = Number(data.format.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无效的视频时长');
    return { duration, tracks, video_codec: video.codec_name };
  }
  async close() {
    this.stopped = true;
    await Promise.all([...this.children].map(child => new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.kill();
    })));
  }
}
