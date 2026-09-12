import path from 'node:path';
import type { MetadataRecord, MetadataMatch, Song } from '../shared/types.js';
export const metadataFields = ['title', 'artist', 'album', 'version'] as const;
const basename = (value: string) => path.posix.basename(value.replaceAll('\\', '/'));
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
export const metadataKey = (record: MetadataRecord) => JSON.stringify([record.sha256, ...metadataFields.map(key => record[key]), record.mapping?.instrumental ?? null, record.mapping?.vocals ?? null]);
export function songRecord(song: Song): MetadataRecord | undefined {
  if (!song.sha256) return;
  return { sha256: song.sha256, filename: song.original_filename || basename(song.file), title: song.title, artist: song.artist, album: song.album, version: song.version, ...(song.mapping ? { mapping: { ...song.mapping } } : {}) };
}
export function recordsFor(songs: Song[]): MetadataRecord[] {
  // Explicitly edited metadata takes precedence over older automatically filled copies.
  const edited = new Set(songs.filter(s => s.metadata_auto !== true && s.sha256).map(s => s.sha256));
  const records = songs.filter(s => s.metadata_auto !== true || !edited.has(s.sha256)).flatMap(s => songRecord(s) || []);
  return [...new Map(records.map(r => [JSON.stringify(r), r])).values()];
}
export class MetadataIndex {
  private hashes = new Map<string, MetadataRecord[]>();
  private filenames = new Map<string, MetadataRecord[]>();
  private titles = new Map<string, MetadataRecord[]>();
  constructor(readonly records: MetadataRecord[]) {
    for (const r of records) for (const [map, key] of [[this.hashes, r.sha256], [this.filenames, normalized(r.filename)], [this.titles, normalized(r.title)]] as const) map.set(key, [...(map.get(key) || []), r]);
  }
  matches(sha256: string | undefined, filename: string, title: string, exclude?: string): MetadataMatch[] {
    const choices: [MetadataMatch['method'], MetadataRecord[] | undefined][] = [
      ['sha256', sha256 ? this.hashes.get(sha256) : undefined], ['filename', this.filenames.get(normalized(filename))], ['title', this.titles.get(normalized(title))],
    ];
    for (const [method, records] of choices) { const candidates = records?.filter(record => metadataKey(record) !== exclude); if (candidates?.length) return [...new Map(candidates.map(record => [metadataKey(record), { method, record }])).values()]; }
    return [];
  }
  exact(sha256: string): MetadataRecord | undefined {
    const records = [...new Map((this.hashes.get(sha256) || []).map(r => [metadataKey(r), r])).values()];
    return records.length === 1 ? records[0] : undefined;
  }
}
export function applyMetadata(song: Song, record: MetadataRecord, exact: boolean) {
  for (const key of metadataFields) song[key] = record[key];
  // Track indexes are only transferable when the actual MP4 bytes match.
  if (exact && record.mapping && song.tracks.some(t => t.index === record.mapping!.instrumental) && (record.mapping.vocals === null || song.tracks.some(t => t.index === record.mapping!.vocals))) song.mapping = { ...record.mapping };
}
export function validateRecord(value: unknown): MetadataRecord {
  const fail = () => { throw new Error('候选歌曲信息无效'); };
  if (!value || typeof value !== 'object') return fail();
  const r = value as Record<string, unknown>;
  if (typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(r.sha256) || typeof r.filename !== 'string' || !r.filename || r.filename.length > 500) return fail();
  for (const key of metadataFields) if (typeof r[key] !== 'string' || (r[key] as string).length > 300 || (key !== 'artist' && !(r[key] as string).trim())) return fail();
  const record: MetadataRecord = { sha256: r.sha256.toLowerCase(), filename: basename(r.filename), title: (r.title as string).trim(), artist: (r.artist as string).trim(), album: (r.album as string).trim(), version: (r.version as string).trim() };
  if (r.mapping !== undefined) {
    const m = r.mapping as Record<string, unknown>;
    if (!m || !Number.isInteger(m.instrumental) || (m.instrumental as number) < 0 || (m.vocals !== null && (!Number.isInteger(m.vocals) || (m.vocals as number) < 0)) || m.instrumental === m.vocals) return fail();
    record.mapping = { instrumental: m.instrumental as number, vocals: m.vocals as number | null };
  }
  return record;
}
