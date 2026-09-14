import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, cp, writeFile, symlink, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { request } from 'node:http';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';
import { fixture, until } from './fixtures.js';
import type { Job, Library, PublicSong } from '../src/shared/types.js';
let root: string;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'karaoke-node-')); await fixture(path.join(root, 'source.mp4')); await fixture(path.join(root, 'original.mp4'), 'Original Mix'); await fixture(path.join(root, 'delayed.mp4'), 'Vocals', true); });
after(async () => { await rm(root, { recursive: true, force: true }); });
async function setup() {
  const folder = await mkdtemp(path.join(root, 'library-'));
  const service = await createApp(folder); const server = await listen(service.app); const url = serverUrl(server);
  const library = await (await fetch(url + '/api/library')).json() as Library;
  const headers = { 'X-Karaoke-Token': library.token };
  const upload = async (filename = 'source.mp4', metadata: Record<string, string> = {}) => {
    const form = new FormData(); form.set('files', new Blob([await readFile(path.join(root, filename))]), filename);
    for (const [key, value] of Object.entries({ album: 'Example album', title: 'Example song', ...metadata })) form.set(key, value);
    const response = await fetch(url + '/api/import', { method: 'POST', headers, body: form });
    assert.equal(response.status, 200); const result = await response.json(); assert.deepEqual(result.errors, []); return result.songs[0] as PublicSong;
  };
  return { ...service, folder, url, headers, upload, close: async () => { await closeServer(server); await service.store.close(); } };
}
async function ready(url: string, id: string, headers: Record<string, string>) {
  const route = `${url}/api/songs/${id}/prepare`;
  await fetch(route, { method: 'POST', headers });
  const job = await until(async () => (await fetch(route)).json() as Promise<Job>, j => j.status === 'ready' || j.status === 'error');
  assert.equal(job.status, 'ready', JSON.stringify(job)); if (job.status !== 'ready') throw new Error('not ready'); return job;
}
function pcm(buffer: Buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  let rate = 0, channels = 0, samples: Buffer = Buffer.alloc(0);
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4), length = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') { channels = buffer.readUInt16LE(offset + 10); rate = buffer.readUInt32LE(offset + 12); assert.equal(buffer.readUInt16LE(offset + 22), 16); }
    if (id === 'data') samples = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  return { rate, channels, frames: samples.length / channels / 2, samples };
}
test('imports distinct versions, preserves v1 catalog IDs and relative paths after relocation', async () => {
  const s = await setup();
  try {
    const a = await s.upload('source.mp4', { version: 'Album' }), b = await s.upload('source.mp4', { version: 'Live' });
    assert.notEqual(a.id, b.id); assert.equal(a.title, b.title);
    const catalog = JSON.parse(await readFile(path.join(s.folder, 'library.json'), 'utf8'));
    assert.equal(catalog.schema_version, 1); assert.equal(path.isAbsolute(catalog.songs[0].file), false);
    const relocated = s.folder + '-moved'; await cp(s.folder, relocated, { recursive: true });
    const moved = await createApp(relocated);
    try { assert.equal(moved.store.db.library_id, catalog.library_id); assert.equal(moved.store.db.songs.length, 2); assert.ok((await moved.store.public(moved.store.db.songs[0])).playable); } finally { await moved.store.close(); }
  } finally { await s.close(); }
});
test('startup loads the catalog without scanning files or launching media tools', async () => {
  const folder = await mkdtemp(path.join(root, 'lazy-startup-'));
  await cp(path.join(root, 'source.mp4'), path.join(folder, 'unindexed.mp4'));
  const { MediaTools } = await import('../src/server/media.js');
  const service = await createApp(folder, { media: new MediaTools('missing-ffmpeg', 'missing-ffprobe') });
  try {
    assert.equal(service.store.db.songs.length, 0);
    assert.deepEqual(await readdir(folder), ['.karaoke-cache', 'unindexed.mp4']);
  } finally { await service.store.close(); }
});
test('PCM roles, duration, stereo rate and HTTP range responses', async () => {
  const s = await setup();
  try {
    const song = await s.upload(), job = await ready(s.url, song.id, s.headers);
    for (const [role, frequency] of [['instrumental', 440], ['vocals', 880]] as const) {
      const wav = pcm(Buffer.from(await (await fetch(s.url + job[role])).arrayBuffer()));
      assert.equal(wav.rate, 44100); assert.equal(wav.channels, 2); assert.equal(wav.frames, 4 * 44100);
      const energy = (frequency: number) => { let real = 0, imag = 0; for (let i = 4410; i < 8820; i++) { const value = wav.samples.readInt16LE(i * 4), angle = 2 * Math.PI * frequency * i / 44100; real += value * Math.cos(angle); imag += value * Math.sin(angle); } return Math.hypot(real, imag); };
      assert.ok(energy(frequency) > energy(1320 - frequency) * 20);
    }
    const range = await fetch(`${s.url}/video/${song.id}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100); assert.match(range.headers.get('content-range')!, /^bytes 0-99\//);
    const audio = await fetch(s.url + job.instrumental, { headers: { Range: 'bytes=0-43' } }); assert.equal(audio.status, 206);
    const badRange = await fetch(`${s.url}/video/${song.id}`, { headers: { Range: 'bytes=999999999-' } }); assert.equal(badRange.status, 416);
    // A completed job must survive duplicate preparation requests without changing its cache URL.
    assert.deepEqual(await ready(s.url, song.id, s.headers), job);
  } finally { await s.close(); }
});
test('delayed vocal stream keeps leading silence and equal stem durations', async () => {
  const s = await setup();
  try {
    const song = await s.upload('delayed.mp4'), job = await ready(s.url, song.id, s.headers);
    const backing = pcm(Buffer.from(await (await fetch(s.url + job.instrumental)).arrayBuffer()));
    const vocals = pcm(Buffer.from(await (await fetch(s.url + job.vocals)).arrayBuffer()));
    assert.equal(backing.frames, vocals.frames);
    const peak = (start: number, end: number) => { let value = 0; for (let i = start; i < end; i++) value = Math.max(value, Math.abs(vocals.samples.readInt16LE(i * 4))); return value; };
    assert.equal(peak(0, 12000), 0); assert.ok(peak(30000, 35000) > 100);
  } finally { await s.close(); }
});
test('Original Mix is never classified as isolated vocals; invalid edits are atomic', async () => {
  const s = await setup();
  try {
    const song = await s.upload('original.mp4'); assert.equal(song.instrumental, 1); assert.equal(song.vocals, null);
    const route = s.url + '/api/songs/' + song.id;
    const bad = await fetch(route, { method: 'PATCH', headers: { ...s.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Must not persist', mapping: { instrumental: 1, vocals: 1 } }) }); assert.equal(bad.status, 400);
    assert.equal(s.store.lookup(song.id).title, song.title);
    const good = await fetch(route, { method: 'PATCH', headers: { ...s.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ album: 'New album', version: 'Live' }) }); assert.equal((await good.json()).version, 'Live');
  } finally { await s.close(); }
});
test('replacing a source preserves metadata, resets track mapping and removes the old library file; deleting removes the new file', async () => {
  const s = await setup();
  try {
    const song = await s.upload();
    await s.store.edit(song.id, { mapping: { instrumental: 1, vocals: 2 } });
    const oldSource = path.join(s.folder, song.file);
    const form = new FormData(); form.set('file', new Blob([await readFile(path.join(root, 'original.mp4'))]), '替换版本.mp4');
    const response = await fetch(s.url + '/api/songs/' + song.id + '/source', { method: 'PUT', headers: s.headers, body: form });
    assert.equal(response.status, 200);
    const replaced = await response.json() as PublicSong;
    assert.equal(replaced.id, song.id); assert.equal(replaced.title, song.title); assert.equal(replaced.album, song.album);
    assert.equal(replaced.original_filename, '替换版本.mp4'); assert.notEqual(replaced.sha256, song.sha256);
    assert.equal(replaced.mapping, undefined); assert.equal(replaced.instrumental, 1); assert.equal(replaced.vocals, null);
    await assert.rejects(access(oldSource), { code: 'ENOENT' });
    const replacementSource = path.join(s.folder, replaced.file); await access(replacementSource);
    const deleted = await fetch(s.url + '/api/songs/' + song.id, { method: 'DELETE', headers: s.headers });
    assert.equal(deleted.status, 204); assert.throws(() => s.store.lookup(song.id), { status: 404 });
    await assert.rejects(access(replacementSource), { code: 'ENOENT' });
  } finally { await s.close(); }
});
test('mutations reject missing token, foreign origin and host; source paths cannot escape library', async () => {
  const s = await setup();
  try {
    assert.equal((await fetch(s.url + '/api/scan', { method: 'POST' })).status, 403);
    assert.equal((await fetch(s.url + '/api/scan', { method: 'POST', headers: { ...s.headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal(await new Promise<number | undefined>((resolve, reject) => { const req = request(s.url + '/api/library', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); }), 403);
    const song = await s.upload();
    const original = s.store.lookup(song.id); original.file = '../source.mp4';
    assert.equal((await fetch(s.url + '/video/' + song.id)).status, 400);
    assert.equal((await s.store.public(original)).missing, true);
    await symlink(path.join(root, 'source.mp4'), path.join(s.folder, 'escape.mp4'));
    original.file = 'escape.mp4'; assert.equal((await s.store.public(original)).missing, true);
    assert.equal((await fetch(s.url + '/audio/not-a-key/instrumental.wav')).status, 404);
  } finally { await s.close(); }
});
test('parallel imports and scans retain every song, UTF-8 names and clean upload temporaries', async () => {
  const s = await setup();
  try {
    await cp(path.join(root, 'source.mp4'), path.join(root, '测试歌曲.mp4'));
    const form = new FormData(); form.set('files', new Blob([await readFile(path.join(root, '测试歌曲.mp4'))]), '测试歌曲.mp4');
    const response = await fetch(s.url + '/api/import', { method: 'POST', headers: s.headers, body: form }); assert.equal((await response.json()).songs[0].title, '测试歌曲');
    await Promise.all([s.upload(), s.upload(), s.store.scan()]);
    const catalog = JSON.parse(await readFile(path.join(s.folder, 'library.json'), 'utf8'));
    assert.equal(catalog.songs.length, 3); assert.equal(new Set(catalog.songs.map((song: PublicSong) => song.id)).size, 3);
    assert.deepEqual(await readdir(s.store.cache), []);
    await writeFile(path.join(s.folder, 'broken.mp4'), 'broken'); await s.store.scan(); assert.equal(s.store.db.songs.length, 3);
  } finally { await s.close(); }
});

test('SHA-256 recognizes renamed duplicate bytes and reuses edited metadata and track mapping', async () => {
  const s = await setup();
  try {
    const original = await s.upload('source.mp4', { title: '已确认曲名', album: '已确认专辑', version: 'Live' });
    const { createHash } = await import('node:crypto');
    assert.equal(original.sha256, createHash('sha256').update(await readFile(path.join(root, 'source.mp4'))).digest('hex'));
    assert.equal(original.original_filename, 'source.mp4');
    await s.store.edit(original.id, { mapping: { instrumental: 1, vocals: 2 } });
    const form = new FormData(); form.set('files', new Blob([await readFile(path.join(root, 'source.mp4'))]), '改名的视频.mp4');
    const result = await (await fetch(s.url + '/api/import', { method: 'POST', headers: s.headers, body: form })).json();
    assert.equal(result.songs[0].title, '已确认曲名'); assert.equal(result.songs[0].version, 'Live'); assert.equal(result.songs[0].original_filename, '改名的视频.mp4');
    assert.deepEqual(result.songs[0].mapping, { instrumental: 1, vocals: 2 }); assert.notEqual(result.songs[0].id, original.id);
    assert.equal(result.songs[0].sha256, original.sha256);
  } finally { await s.close(); }
});
test('same filename with different bytes requires confirmation and cannot copy track mapping', async () => {
  const s = await setup();
  try {
    const original = await s.upload('source.mp4', { title: '已确认曲名' });
    await s.store.edit(original.id, { mapping: { instrumental: 1, vocals: 2 } });
    const form = new FormData(); form.set('files', new Blob([await readFile(path.join(root, 'original.mp4'))]), 'source.mp4');
    const result = await (await fetch(s.url + '/api/import', { method: 'POST', headers: s.headers, body: form })).json();
    const song = result.songs[0] as PublicSong;
    assert.notEqual(song.sha256, original.sha256); assert.equal(song.title, 'source'); assert.equal(song.vocals, null);
    const match = song.metadata_matches![0]; assert.equal(match.method, 'filename');
    const applied = await (await fetch(s.url + '/api/songs/' + song.id + '/match', { method: 'POST', headers: { ...s.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(match.record) })).json();
    assert.equal(applied.title, '已确认曲名'); assert.equal(applied.mapping, undefined); assert.equal(applied.vocals, null);
    const invalid = await fetch(s.url + '/api/songs/' + song.id + '/match', { method: 'POST', headers: { ...s.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...match.record, title: '不存在的候选' }) }); assert.equal(invalid.status, 400);
  } finally { await s.close(); }
});
test('conflicting metadata for identical hashes stays a choice, not an arbitrary automatic match', async () => {
  const s = await setup();
  try {
    await s.upload('source.mp4', { version: 'Album' }); await s.upload('source.mp4', { version: 'Live' });
    const song = await s.upload('source.mp4', { title: '', album: '', version: '' });
    assert.equal(song.title, 'source'); assert.equal(song.version, '卡拉 OK');
    assert.equal(song.metadata_matches?.length, 2); assert.ok(song.metadata_matches?.every(m => m.method === 'sha256'));
    assert.equal((await fetch(s.url + '/api/metadata/export')).status, 404);
  } finally { await s.close(); }
});
test('scan reconnects a moved video to its existing ID and backfills legacy fingerprints', async () => {
  const s = await setup();
  try {
    const song = await s.upload();
    const { rename } = await import('node:fs/promises');
    await rename(path.join(s.folder, song.file), path.join(s.folder, 'Moved.mp4'));
    await s.store.scan();
    assert.equal(s.store.db.songs.length, 1); assert.equal(s.store.lookup(song.id).file, 'Moved.mp4'); assert.equal(s.store.lookup(song.id).title, song.title);
    delete s.store.lookup(song.id).sha256; delete s.store.lookup(song.id).hash_stamp;
    await s.store.scan(); assert.equal(s.store.lookup(song.id).sha256, song.sha256);
    const stamp = s.store.lookup(song.id).hash_stamp; await s.store.scan(); assert.equal(s.store.lookup(song.id).hash_stamp, stamp);
  } finally { await s.close(); }
});

test('album order is persisted and rejects stale, duplicate and cross-album IDs atomically', async () => {
  const s = await setup();
  try {
    const a = await s.upload('source.mp4', { title: 'A' }), b = await s.upload('source.mp4', { title: 'B' });
    const other = await s.upload('source.mp4', { album: 'Other' });
    const post = (song_ids: string[]) => fetch(s.url + '/api/library/order', { method: 'POST', headers: { ...s.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ album: 'Example album', song_ids }) });
    assert.equal((await post([b.id, a.id])).status, 200);
    assert.equal(s.store.lookup(b.id).sort_order, 0); assert.equal(s.store.lookup(a.id).sort_order, 1);
    assert.equal((await post([a.id, a.id])).status, 400);
    assert.equal((await post([other.id, a.id])).status, 409);
    assert.equal((await post([a.id])).status, 409);
    assert.equal(s.store.lookup(b.id).sort_order, 0);
    const moved = s.folder + '-ordered'; await cp(s.folder, moved, { recursive: true });
    const reopened = await createApp(moved);
    try { assert.equal(reopened.store.lookup(b.id).sort_order, 0); assert.equal(reopened.store.lookup(a.id).sort_order, 1); assert.equal(reopened.store.lookup(other.id).sort_order, undefined); }
    finally { await reopened.store.close(); }
  } finally { await s.close(); }
});

test('album order survives relocation and validates the complete album set', async () => {
  const s = await setup();
  try {
    await s.upload('source.mp4', { album: 'A' }); await s.upload('source.mp4', { album: 'B' });
    const post = (albums: string[]) => fetch(s.url + '/api/library/albums/order', { method: 'POST', headers: { ...s.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ albums }) });
    assert.equal((await post(['B', 'A'])).status, 200);
    assert.deepEqual((await (await fetch(s.url + '/api/library')).json()).album_order, ['B', 'A']);
    assert.equal((await post(['A', 'A'])).status, 400);
    assert.equal((await post(['A'])).status, 409);
    assert.equal((await post(['A', 'unknown'])).status, 409);
    assert.deepEqual(s.store.db.album_order, ['B', 'A']);
    const moved = s.folder + '-albums'; await cp(s.folder, moved, { recursive: true });
    const reopened = await createApp(moved);
    try { assert.deepEqual(reopened.store.db.album_order, ['B', 'A']); }
    finally { await reopened.store.close(); }
  } finally { await s.close(); }
});

test('occupied port rejects with EADDRINUSE, fallback listens and keeps the same origin on library switch', async () => {
  const express = (await import('express')).default;
  const { createServer } = await import('node:http');
  const { listenAvailable, serverPort } = await import('../src/server/app.js');
  const owner = await listen(express());
  let fallback: Awaited<ReturnType<typeof listen>> | undefined;
  try {
    const port = serverPort(owner);
    await assert.rejects(listen(express(), port), { code: 'EADDRINUSE' });
    fallback = await listenAvailable(express(), port);
    assert.ok(fallback.listening); assert.notEqual(serverPort(fallback), port);
    const origin = serverUrl(fallback), activePort = serverPort(fallback);
    await closeServer(fallback);
    assert.throws(() => serverUrl(fallback!), { code: 'ERR_SERVER_NOT_LISTENING' });
    await closeServer(fallback); // Repeated cleanup must be safe after startup failures.
    fallback = await listen(express(), activePort);
    assert.equal(serverUrl(fallback), origin);
    assert.ok(owner.listening);
    assert.throws(() => serverUrl(createServer()), { code: 'ERR_SERVER_NOT_LISTENING' });
  } finally { if (fallback) await closeServer(fallback); await closeServer(owner); }
});
