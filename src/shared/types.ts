export interface Track { index: number; name: string; role: 'instrumental' | 'vocals' | 'unknown' }
export interface Song {
  id: string; file: string; title: string; artist: string; album: string; version: string;
  sort_order?: number;
  sha256?: string; original_filename?: string; hash_stamp?: string; metadata_auto?: boolean;
  duration: number; tracks: Track[]; video_codec: string;
  mapping?: { instrumental: number; vocals: number | null };
}
export interface PublicSong extends Song { instrumental: number | null; vocals: number | null; missing: boolean; playable: boolean; metadata_matches?: MetadataMatch[] }
export interface Catalog { schema_version: 1; library_id: string; songs: Song[]; album_order?: string[] }
export interface Library { token: string; library_id: string; folder: string; songs: PublicSong[]; album_order?: string[] }
export type Job = { status: 'pending' | 'preparing' } | { status: 'error'; error: string } | { status: 'ready'; instrumental: string; vocals: string | null };

export interface MetadataRecord {
  sha256: string; filename: string; title: string; artist: string; album: string; version: string;
  mapping?: { instrumental: number; vocals: number | null };
}
export interface MetadataMatch { method: 'sha256' | 'filename' | 'title'; record: MetadataRecord }

export interface PlaybackState { kind: 'state'; song: { id: string; title: string; duration: number } | null; upcoming?: { title: string; artist: string; version: string } | null; position: number; playing: boolean; sent: number; revision: number }

export const songGroupKey = (song: Song) => JSON.stringify([song.album, song.title, song.artist]);
export const compareSongOrder = (a: Song, b: Song) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title);

export function orderedAlbums(songs: Song[], saved: string[] = []) {
  const names = new Set(songs.map(song => song.album));
  const ordered = [...new Set(saved)].filter(name => names.has(name));
  const known = new Set(ordered);
  return [...ordered, ...[...names].filter(name => !known.has(name)).sort((a, b) => a.localeCompare(b))];
}
