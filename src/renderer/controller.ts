import { compareSongOrder, songGroupKey, orderedAlbums } from '../shared/types';
import { StemPlayer } from './audio';
import type { Job, Library, PublicSong } from '../shared/types';
export type Settings = { backing: number; vocals: number; master: number; delay: number };
export type HistoryEntry = { id: string; at: number };
export class Controller {
  songs: PublicSong[] = []; queue: string[] = []; history: HistoryEntry[] = [];
  settings: Settings = { backing: 1, vocals: 0, master: .8, delay: 0 };
  albumOrder: string[] = [];
  reordering = false;
  current: PublicSong | null = null; loading = false; muted = false; status = '就绪'; message = ''; folder = '';
  noticeScope: 'app' | 'library' = 'app';
  private autoStartAt: number | null = null;
  get autoStartSeconds() { return this.autoStartAt === null ? 0 : Math.max(0, Math.ceil((this.autoStartAt - Date.now()) / 1000)); }
  private get idle() { return !this.loading && !this.player.playing && (!this.current || !this.player.buffers.length || this.player.position() >= this.player.duration); }
  private cancelAutoStart() { this.autoStartAt = null; }
  get upcomingSong() {
    const remaining = this.player.duration - this.player.position();
    return this.current && this.player.playing && !this.loading && remaining > 0 && remaining <= 45
      ? this.songs.find(song => song.id === this.queue[0]) : undefined;
  }
  private tickAutoStart() {
    if (this.autoStartAt === null) return;
    if (!this.queue.length || !this.idle) { this.cancelAutoStart(); return; }
    if (Date.now() >= this.autoStartAt) {
      this.cancelAutoStart();
      void this.next().catch(error => this.notice(error.message));
    }
  }
  readonly channelId = crypto.randomUUID();
  private channel = new BroadcastChannel('karaoke-' + this.channelId);
  readonly player = new StemPlayer(() => { this.record(); void this.next().catch(e => this.notice(e.message)); });
  private token = ''; private storeKey = ''; private loaded = false; private generation = 0;
  private abortLoad?: AbortController; private timer?: ReturnType<typeof setInterval>; private noticeTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<() => void>(); private revision = 0; private transportRevision = 0; private lastVideoSeek = -Infinity;
  // Clock ticks update playback indicators without invalidating the library view.
  private playbackListeners = new Set<() => void>();
  private playbackRevision = 0; private lastPosition = 0; private lastCountdown = 0;
  private video?: HTMLVideoElement;
  subscribePlayback = (fn: () => void) => { this.playbackListeners.add(fn); return () => { this.playbackListeners.delete(fn); }; };
  playbackSnapshot = () => this.playbackRevision;
  private playbackChanged(force = false) {
    const position = this.player.position(), countdown = this.autoStartSeconds;
    if (!force && position === this.lastPosition && countdown === this.lastCountdown) return;
    this.lastPosition = position; this.lastCountdown = countdown; this.playbackRevision++;
    this.playbackListeners.forEach(fn => fn());
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.revision;
  changed = () => { this.revision++; this.playbackChanged(true); this.listeners.forEach(fn => fn()); };
  constructor() { this.channel.onmessage = event => { if (event.data.kind === 'ready') this.broadcast(); }; }
  mount(video: HTMLVideoElement) {
    this.video = video;
    this.timer = setInterval(() => { this.tickAutoStart(); this.syncVideo(); this.broadcast(); this.playbackChanged(); }, 200);
    void this.refresh().catch(e => this.notice(e.message));
  }
  destroy() { this.cancelAutoStart(); this.generation++; this.abortLoad?.abort(); clearInterval(this.timer); clearTimeout(this.noticeTimer); this.channel.postMessage({ kind: 'closed' }); this.channel.close(); this.player.clear(); void this.player.ctx?.close(); }
  notice(message: string, scope: 'app' | 'library' = 'app') { this.message = message; this.noticeScope = scope; clearTimeout(this.noticeTimer); this.noticeTimer = setTimeout(() => { this.message = ''; this.changed(); }, 6000); this.changed(); }
  libraryNotice(message: string) { this.notice(message, 'library'); }
  async api<T>(url: string, method = 'GET', body?: FormData | object): Promise<T> {
    const headers: Record<string, string> = { 'X-Karaoke-Token': this.token };
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({ error: `请求失败 (${response.status})` }));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
  }
  private persist() { if (!this.storeKey) return; try { localStorage.setItem(this.storeKey, JSON.stringify({ queue: this.queue, history: this.history, settings: this.settings })); } catch { this.notice('浏览器存储不可用，点歌记录仅在本次保留'); } }
  async refresh(scan = false) {
    const library = await this.api<Library>(scan ? '/api/scan' : '/api/library', scan ? 'POST' : 'GET');
    this.albumOrder = library.album_order || []; this.token = library.token; this.songs = library.songs; this.folder = library.folder; this.storeKey = 'karaoke:' + library.library_id;
    if (!this.loaded) {
      try {
        const saved = JSON.parse(localStorage.getItem(this.storeKey) || '{}');
        this.queue = Array.isArray(saved.queue) ? saved.queue.filter((id: unknown) => typeof id === 'string') : [];
        this.history = Array.isArray(saved.history) ? saved.history.filter((item: HistoryEntry) => item && typeof item.id === 'string' && Number.isFinite(item.at)) : [];
        for (const key of Object.keys(this.settings) as (keyof Settings)[]) { const value = Number(saved.settings?.[key]); if (Number.isFinite(value)) this.settings[key] = Math.max(key === 'delay' ? -300 : 0, Math.min(key === 'delay' ? 300 : 1, value)); }
      } catch { /* Corrupt browser preferences do not affect the library. */ }
      this.loaded = true;
    }
    this.queue = this.queue.filter(id => this.songs.some(s => s.id === id)); this.levels(); this.changed();
  }
  levels() { this.player.setLevels(this.settings.backing, this.settings.vocals, this.muted ? 0 : this.settings.master); this.persist(); }
  setLevel(key: keyof Settings, value: number) { this.settings[key] = value; this.levels(); this.changed(); }
  toggleMute() { this.muted = !this.muted; this.levels(); this.changed(); }
  toggleGuide() { if (!this.player.buffers[1]) return; this.setLevel('vocals', this.settings.vocals > 0 ? 0 : 1); }
  add = (id: string) => {
    this.queue.push(id);
    if (this.idle && this.autoStartAt === null) {
      const deadline = this.autoStartAt = Date.now() + 10000;
      // Unlock during the user's click so playback is allowed after the countdown.
      void this.player.unlock().catch(error => {
        if (this.autoStartAt !== deadline) return;
        this.cancelAutoStart(); this.notice(error.message);
      });
    }
    this.persist(); this.libraryNotice('已加入待唱');
  };
  remove(index: number) { this.queue.splice(index, 1); if (!this.queue.length) this.cancelAutoStart(); this.persist(); this.changed(); }
  moveUp(index: number) { if (index > 0) { [this.queue[index - 1], this.queue[index]] = [this.queue[index], this.queue[index - 1]]; this.persist(); this.changed(); } }
  async reorderAlbum(source: string, target: string, after = false) {
    if (this.reordering || source === target) return;
    const albums = orderedAlbums(this.songs, this.albumOrder);
    if (!albums.includes(source) || !albums.includes(target)) return;
    albums.splice(albums.indexOf(source), 1);
    albums.splice(albums.indexOf(target) + (after ? 1 : 0), 0, source);
    this.reordering = true; this.changed();
    try {
      const result = await this.api<Library>('/api/library/albums/order', 'POST', { albums });
      this.songs = result.songs; this.albumOrder = result.album_order || []; this.libraryNotice('已保存专辑顺序');
    } finally { this.reordering = false; this.changed(); }
  }
  async moveAlbum(name: string, direction: -1 | 1) {
    const albums = orderedAlbums(this.songs, this.albumOrder), index = albums.indexOf(name);
    const target = albums[index + direction];
    if (index >= 0 && target !== undefined) await this.reorderAlbum(name, target, direction === 1);
  }
  private albumGroups(album: string) {
    const groups = new Map<string, PublicSong[]>();
    for (const song of this.songs.filter(s => s.album === album).sort(compareSongOrder)) {
      const key = songGroupKey(song); groups.set(key, [...(groups.get(key) || []), song]);
    }
    return [...groups.values()];
  }
  async reorderSong(sourceId: string, targetId: string, after = false) {
    if (this.reordering) return;
    const source = this.songs.find(s => s.id === sourceId), target = this.songs.find(s => s.id === targetId);
    if (!source || !target || source.album !== target.album || songGroupKey(source) === songGroupKey(target)) return;
    const groups = this.albumGroups(source.album);
    const moving = groups.splice(groups.findIndex(group => songGroupKey(group[0]) === songGroupKey(source)), 1)[0];
    const index = groups.findIndex(group => songGroupKey(group[0]) === songGroupKey(target));
    groups.splice(index + (after ? 1 : 0), 0, moving);
    this.reordering = true; this.changed();
    try {
      const result = await this.api<Library>('/api/library/order', 'POST', { album: source.album, song_ids: groups.flat().map(s => s.id) });
      this.songs = result.songs; this.albumOrder = result.album_order || []; this.libraryNotice('已保存专辑内的歌曲顺序');
    } finally { this.reordering = false; this.changed(); }
  }
  async moveLibrarySong(id: string, direction: -1 | 1) {
    const song = this.songs.find(s => s.id === id); if (!song) return;
    const groups = this.albumGroups(song.album), index = groups.findIndex(group => songGroupKey(group[0]) === songGroupKey(song));
    const target = groups[index + direction]; if (target) await this.reorderSong(id, target[0].id, direction === 1);
  }
  private record() { if (this.current) { this.history = [{ id: this.current.id, at: Date.now() }, ...this.history].slice(0, 100); this.persist(); this.changed(); } }
  loadSong = async (id: string, queueIndex?: number) => {
    this.cancelAutoStart();
    await this.player.unlock();
    const generation = ++this.generation; this.transportRevision++;
    this.abortLoad?.abort(); this.abortLoad = new AbortController();
    this.player.clear(); this.video!.pause(); this.current = this.songs.find(s => s.id === id) || null;
    if (!this.current) { this.loading = false; this.changed(); return; }
    const selected = this.current;
    this.loading = true; this.status = '准备音轨…'; this.video!.src = '/video/' + id; this.video!.muted = true; this.broadcast(); this.changed();
    try {
      let job = await this.api<Job>(`/api/songs/${id}/prepare`, 'POST');
      while (job.status !== 'ready') {
        if (generation !== this.generation) return;
        if (job.status === 'error') throw new Error(job.error);
        await new Promise(resolve => setTimeout(resolve, 350));
        if (generation !== this.generation) return;
        job = await this.api<Job>(`/api/songs/${id}/prepare`);
      }
      this.status = '载入音轨…'; this.changed();
      const buffers: (AudioBuffer | null)[] = [];
      for (const url of [job.instrumental, job.vocals]) {
        if (generation !== this.generation) return;
        if (!url) { buffers.push(null); continue; }
        const response = await fetch(url, { signal: this.abortLoad.signal });
        if (!response.ok) throw new Error('音轨读取失败');
        buffers.push(await this.player.ctx.decodeAudioData(await response.arrayBuffer()));
      }
      if (generation !== this.generation) return;
      this.player.load(buffers, selected.duration); this.loading = false;
      if (queueIndex !== undefined && this.queue[queueIndex] === id) this.queue.splice(queueIndex, 1);
      this.levels(); await this.play();
    } catch (error) {
      if (generation !== this.generation || (error as Error).name === 'AbortError') return;
      this.loading = false; this.player.clear(); this.status = '无法播放'; this.notice((error as Error).message); this.broadcast();
    }
    this.changed();
  };
  play = async () => {
    const startingQueue = this.autoStartAt !== null;
    this.cancelAutoStart();
    if (startingQueue) { await this.next(); return; }
    if (this.loading) return;
    if (!this.current) { await this.next(); return; }
    if (!this.player.buffers.length) return;
    await this.player.unlock(); this.transportRevision++; this.player.start(); this.levels();
    this.video!.muted = true; this.video!.currentTime = this.targetPosition();
    void this.video!.play().catch(e => { if (e.name !== 'AbortError') this.notice('视频未能播放，请检查 MP4 是否为浏览器支持的 H.264 编码'); });
    this.status = '播放中'; this.broadcast(); this.changed();
  };
  pause = () => { this.cancelAutoStart(); this.transportRevision++; this.player.pause(); this.video?.pause(); this.status = '已暂停'; this.broadcast(); this.changed(); };
  async next() { if (this.queue.length) await this.loadSong(this.queue[0], 0); else { this.pause(); this.status = '待唱列表为空'; this.changed(); } }
  seek(value: number) { this.transportRevision++; this.player.seek(value); this.lastVideoSeek = -Infinity; this.syncVideo(true); this.broadcast(); this.changed(); }
  private targetPosition() { return Math.max(0, Math.min(this.player.duration || this.current?.duration || 0, this.player.position() - this.settings.delay / 1000)); }
  private syncVideo(force = false) {
    if (!this.current || this.loading || !this.video) return;
    const target = this.targetPosition(), drift = target - this.video.currentTime;
    if (!this.video.seeking && Math.abs(drift) > (force || !this.player.playing ? .025 : .35) && (force || performance.now() - this.lastVideoSeek >= 700)) { this.lastVideoSeek = performance.now(); this.video.currentTime = target; }
    this.video.playbackRate = this.player.playing && !this.video.seeking && Math.abs(drift) > .05 && Math.abs(drift) < .35 ? 1 + Math.sign(drift) * .025 : 1;
    if (this.player.playing && this.video.paused) void this.video.play().catch(() => {});
    if (!this.player.playing && !this.video.paused) this.video.pause();
  }
  private broadcast() { const next = this.upcomingSong; this.channel.postMessage({ kind: 'state', upcoming: next ? { title: next.title, artist: next.artist, version: next.version } : null, song: this.current ? { id: this.current.id, title: this.current.title, duration: this.current.duration } : null, position: this.targetPosition(), playing: this.player.playing && !this.loading, sent: performance.timeOrigin + performance.now(), revision: this.transportRevision }); }
  openDisplay() {
    const popup = window.open('/display?session=' + this.channelId, 'karaoke-display-' + this.channelId, 'popup,width=1280,height=720');
    this.notice(popup ? '将观众窗口拖到 HDMI 屏幕，再点击全屏' : '请允许弹出窗口');
  }
}
