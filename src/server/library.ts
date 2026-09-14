import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { MetadataIndex, recordsFor, songRecord, metadataKey, applyMetadata, validateRecord, metadataFields } from './metadata.js';
import { mkdir, readFile, writeFile, rename, readdir, realpath, stat, access, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Catalog, Song, PublicSong, Job } from '../shared/types.js';
import { MediaTools } from './media.js';

export class LibraryStore {
  db!: Catalog;
  readonly cache: string;
  readonly jobs = new Map<string, Job>();
  private serial: Promise<unknown> = Promise.resolve();
  private running = 0;
  private pending: (() => Promise<void>)[] = [];
  private active = new Set<Promise<void>>();
  private closing = false;
  private recognition?: MetadataIndex;
  private index() { return this.recognition ??= new MetadataIndex(recordsFor(this.db.songs)); }
  private invalidate() { this.recognition = undefined; }
  private async fingerprint(file: string) {
    const before = await stat(file, { bigint: true });
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) { if (this.closing) throw new Error('服务已关闭'); hash.update(chunk); }
    const after = await stat(file, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('文件在读取时发生变化，请重新导入');
    return { sha256: hash.digest('hex'), hash_stamp: `${after.size}:${after.mtimeNs}:${after.ctimeNs}` };
  }
  private recognize(song: Song) {
    const record = song.sha256 ? this.index().exact(song.sha256) : undefined;
    if (record) applyMetadata(song, record, true);
  }
  private async sourceReferenced(source: string, excludeId: string) {
    for (const song of this.db.songs) {
      if (song.id === excludeId) continue;
      try { if (await this.source(song) === source) return true; } catch { /* Missing records do not retain a source file. */ }
    }
    return false;
  }

  constructor(readonly folder: string, readonly media: MediaTools) { this.cache = path.join(folder, '.karaoke-cache'); }
  async init() {
    await mkdir(this.cache, { recursive: true });
    try { this.db = JSON.parse(await readFile(path.join(this.folder, 'library.json'), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; this.db = { schema_version: 1, library_id: randomUUID().replaceAll('-', ''), songs: [] }; }
    if (this.db.schema_version !== 1 || !Array.isArray(this.db.songs)) throw new Error('不支持的曲库版本');
  }
  // Serialize read-modify-write operations, including asynchronous scans/imports.
  mutate<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.serial.then(fn);
    this.serial = next.catch(() => {});
    return next;
  }
  async save() {
    this.invalidate();
    const dest = path.join(this.folder, 'library.json');
    await writeFile(dest + '.tmp', JSON.stringify(this.db, null, 2));
    await rename(dest + '.tmp', dest);
  }
  async source(song: Song) {
    const target = await realpath(path.resolve(this.folder, song.file));
    const relative = path.relative(this.folder, target);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) || !(await stat(target)).isFile()) throw new Error('媒体文件缺失或位于曲库之外');
    return target;
  }
  roles(song: Song): [number | null, number | null] {
    return [song.mapping ? song.mapping.instrumental : song.tracks.find(t => t.role === 'instrumental')?.index ?? (song.tracks.length === 1 ? song.tracks[0].index : null), song.mapping ? song.mapping.vocals : song.tracks.find(t => t.role === 'vocals')?.index ?? null];
  }
  async public(song: Song): Promise<PublicSong> {
    const [instrumental, vocals] = this.roles(song);
    let missing = false; try { await this.source(song); } catch { missing = true; }
    const own = songRecord(song);
    const metadata_matches = this.index().matches(song.sha256, song.original_filename || path.basename(song.file), song.title, own ? metadataKey(own) : undefined).slice(0, 20);
    return { ...song, instrumental, vocals, missing, playable: instrumental !== null && !missing, metadata_matches };
  }
  lookup(id: string) { const song = this.db.songs.find(s => s.id === id); if (!song) throw Object.assign(new Error('歌曲不存在'), { status: 404 }); return song; }
  async scan() {
    await this.mutate(async () => {
      // Backfill fingerprints once, then reuse them unless file size/timestamps change.
      for (const song of this.db.songs) {
        try {
          const file = await this.source(song), info = await stat(file, { bigint: true });
          if (!song.sha256 || song.hash_stamp !== `${info.size}:${info.mtimeNs}:${info.ctimeNs}`) {
            const fingerprint = await this.fingerprint(file);
            if (song.sha256 && song.sha256 !== fingerprint.sha256) { Object.assign(song, await this.media.probe(file)); delete song.mapping; }
            Object.assign(song, fingerprint);
          }
          song.original_filename ||= path.basename(song.file);
        } catch { /* Missing files remain listed with their last known fingerprint. */ }
      }
      this.invalidate();
      const known = new Set(this.db.songs.map(s => s.file));
      const walk = async (directory: string): Promise<void> => {
        for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) { await walk(full); continue; }
          const file = path.relative(this.folder, full).split(path.sep).join('/');
          if (path.extname(file).toLowerCase() !== '.mp4' || known.has(file)) continue;
          try {
            const info = await this.media.probe(full), fingerprint = await this.fingerprint(full);
            // Renamed/moved files reconnect the existing row (and queue/history ID).
            const old = this.db.songs.filter(s => s.sha256 === fingerprint.sha256);
            const missing = [];
            for (const song of old) { try { await this.source(song); } catch { missing.push(song); } }
            if (missing.length === 1) { Object.assign(missing[0], { file, original_filename: entry.name }, fingerprint); }
            else {
              const song: Song = { id: randomUUID().replaceAll('-', ''), file, original_filename: entry.name, metadata_auto: true, title: path.parse(file).name, artist: '', album: '未分类', version: '卡拉 OK', ...info, ...fingerprint };
              this.recognize(song); this.db.songs.push(song);
            }
            this.invalidate(); known.add(file);
          } catch { /* Ignore unreadable media during discovery. */ }
        }
      };
      await walk(this.folder); await this.save();
    });
  }
  async importFile(file: string, filename: string, metadata: Record<string, unknown>) {
    const info = await this.media.probe(file), fingerprint = await this.fingerprint(file), id = randomUUID().replaceAll('-', '');
    return this.mutate(async () => {
      const song: Song = { id, file: `media/${id}.mp4`, original_filename: filename, metadata_auto: true, title: path.parse(filename).name, artist: '', album: '未分类', version: '卡拉 OK', ...info, ...fingerprint };
      this.recognize(song);
      for (const key of metadataFields) if (typeof metadata[key] === 'string' && metadata[key].trim()) { song[key] = metadata[key].trim().slice(0, 300); song.metadata_auto = false; }
      await mkdir(path.join(this.folder, 'media'), { recursive: true });
      await rename(file, path.join(this.folder, song.file));
      this.db.songs.push(song);
      try { await this.save(); } catch (e) { this.db.songs.pop(); await rm(path.join(this.folder, song.file), { force: true }); throw e; }
      return this.public(song);
    });
  }
  async replaceSource(id: string, file: string, filename: string) {
    const info = await this.media.probe(file), fingerprint = await this.fingerprint(file);
    return this.mutate(async () => {
      const song = this.lookup(id), previousSource = await this.source(song).catch(() => undefined);
      const replacementFile = `media/${id}-${randomUUID().replaceAll('-', '')}.mp4`;
      const replacementSource = path.join(this.folder, replacementFile);
      await mkdir(path.dirname(replacementSource), { recursive: true });
      await rename(file, replacementSource);
      const updated: Song = { ...song, file: replacementFile, original_filename: filename, metadata_auto: false, ...info, ...fingerprint };
      delete updated.mapping;
      const index = this.db.songs.indexOf(song); this.db.songs[index] = updated;
      try { await this.save(); }
      catch (error) { this.db.songs[index] = song; await rm(replacementSource, { force: true }); throw error; }
      if (previousSource && !(await this.sourceReferenced(previousSource, id))) await rm(previousSource, { force: true });
      return this.public(updated);
    });
  }
  async delete(id: string) {
    return this.mutate(async () => {
      const song = this.lookup(id), source = await this.source(song).catch(() => undefined);
      const index = this.db.songs.indexOf(song), previousAlbumOrder = this.db.album_order;
      this.db.songs.splice(index, 1);
      if (!this.db.songs.some(other => other.album === song.album)) this.db.album_order = previousAlbumOrder?.filter(album => album !== song.album);
      try { await this.save(); }
      catch (error) { this.db.songs.splice(index, 0, song); this.db.album_order = previousAlbumOrder; throw error; }
      if (source && !(await this.sourceReferenced(source, id))) await rm(source, { force: true });
    });
  }
  async edit(id: string, data: Record<string, unknown>) {
    return this.mutate(async () => {
      const song = this.lookup(id), updated = { ...song };
      for (const key of ['title', 'artist', 'album', 'version'] as const) {
        if (!(key in data)) continue;
        if (typeof data[key] !== 'string') throw new Error('歌曲信息必须为文本');
        const value = data[key].trim().slice(0, 300);
        if (!value && key !== 'artist') throw new Error('曲名、专辑和版本不能为空');
        updated[key] = value;
      }
      if ('mapping' in data) {
        const mapping = data.mapping as Song['mapping'];
        const ids = song.tracks.map(t => t.index);
        if (!mapping || !ids.includes(mapping.instrumental)) throw new Error('请选择有效的伴奏音轨');
        if (mapping.vocals != null && !ids.includes(mapping.vocals)) throw new Error('请选择有效的人声音轨');
        if (mapping.vocals === mapping.instrumental) throw new Error('伴奏与纯人声不能是同一条轨道');
        updated.mapping = { instrumental: mapping.instrumental, vocals: mapping.vocals ?? null };
      }
      updated.metadata_auto = false;
      const index = this.db.songs.indexOf(song); this.db.songs[index] = updated;
      try { await this.save(); } catch (e) { this.db.songs[index] = song; throw e; }
      return this.public(updated);
    });
  }
  async reorderAlbums(albums: unknown) {
    if (!Array.isArray(albums) || albums.some(name => typeof name !== 'string') || new Set(albums).size !== albums.length) throw new Error('无效的专辑排序');
    return this.mutate(async () => {
      const expected = new Set(this.db.songs.map(song => song.album));
      if (expected.size !== albums.length || albums.some(name => !expected.has(name))) throw Object.assign(new Error('专辑列表已变化，请刷新后重试'), { status: 409 });
      const previous = this.db.album_order;
      this.db.album_order = [...albums];
      try { await this.save(); } catch (error) { this.db.album_order = previous; throw error; }
    });
  }
  async reorder(album: unknown, ids: unknown) {
    if (typeof album !== 'string' || !Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('无效的歌曲排序');
    return this.mutate(async () => {
      const songs = this.db.songs.filter(song => song.album === album);
      const expected = new Set(songs.map(song => song.id));
      if (songs.length !== ids.length || ids.some(id => !expected.has(id))) throw Object.assign(new Error('专辑内容已变化，请刷新后重试'), { status: 409 });
      const previous = songs.map(song => song.sort_order);
      const positions = new Map(ids.map((id, index) => [id, index]));
      songs.forEach(song => { song.sort_order = positions.get(song.id)!; });
      try { await this.save(); } catch (error) { songs.forEach((song, index) => { song.sort_order = previous[index]; }); throw error; }
    });
  }
  async applyMatch(id: string, input: unknown) {
    const record = validateRecord(input);
    const song = this.lookup(id);
    if (!this.index().matches(song.sha256, song.original_filename || path.basename(song.file), song.title, songRecord(song) ? metadataKey(songRecord(song)!) : undefined).some(m => metadataKey(m.record) === metadataKey(record))) throw new Error('候选记录已变化，请刷新后重试');
    const update: Record<string, unknown> = Object.fromEntries(metadataFields.map(key => [key, record[key]]));
    if (record.sha256 === song.sha256 && record.mapping) {
      const copy = structuredClone(song); applyMetadata(copy, record, true);
      if (copy.mapping) update.mapping = copy.mapping;
    }
    return this.edit(id, update);
  }
  async preparation(id: string, start: boolean): Promise<Job> {
    const song = structuredClone(this.lookup(id));
    const source = await this.source(song), info = await stat(source, { bigint: true });
    const key = createHash('sha256').update(`pcm-node-v1:${song.id}:${info.size}:${info.mtimeNs}:${this.roles(song)}`).digest('hex').slice(0, 24);
    if (start && (!this.jobs.has(key) || this.jobs.get(key)?.status === 'error')) {
      if (this.closing) throw new Error('服务正在关闭');
      this.jobs.set(key, { status: 'preparing' });
      this.pending.push(() => this.prepare(song, source, key)); this.drain();
    }
    return this.jobs.get(key) || { status: 'pending' };
  }
  private drain() {
    while (!this.closing && this.running < 2 && this.pending.length) {
      this.running++;
      const task = this.pending.shift()!().finally(() => { this.running--; this.active.delete(task); this.drain(); });
      this.active.add(task);
    }
  }
  private async prepare(song: Song, source: string, key: string) {
    const folder = path.join(this.cache, key);
    try {
      await mkdir(folder, { recursive: true });
      const [instrumental, vocals] = this.roles(song);
      if (instrumental === null) throw new Error('请先在编辑中确认伴奏音轨');
      for (const [role, index] of [['instrumental', instrumental], ['vocals', vocals]] as const) {
        if (index === null) continue;
        const dest = path.join(folder, `${role}.wav`);
        try { await access(dest); continue; } catch { /* Decode uncached stems. */ }
        try {
          await this.media.run(this.media.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-copyts', '-i', source, '-map', `0:${index}`, '-vn', '-af', `aresample=44100:async=1:first_pts=0,apad,atrim=duration=${song.duration}`, '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', dest + '.tmp.wav']);
          await rename(dest + '.tmp.wav', dest);
        } finally { await rm(dest + '.tmp.wav', { force: true }); }
      }
      this.jobs.set(key, { status: 'ready', instrumental: `/audio/${key}/instrumental.wav`, vocals: vocals === null ? null : `/audio/${key}/vocals.wav` });
    } catch (e) { this.jobs.set(key, { status: 'error', error: (e as Error).message.slice(0, 400) }); }
  }
  async close() { this.closing = true; this.pending = []; await this.media.close(); await Promise.all(this.active); await this.serial; }
}
