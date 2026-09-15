import { useSyncExternalStore, type CSSProperties } from 'react';
import type { Controller } from './controller';

type Props = { controller: Controller };
const time = (s: number) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const upcomingDetails = (c: Controller) => {
  const song = c.upcomingSong;
  return song ? ['下一首', song.title, song.artist, song.version].filter(Boolean).join(' · ') : c.status;
};

// Only these small views subscribe to the playback clock; the library does not.
export function PlaybackTimeline({ controller: c }: Props) {
  useSyncExternalStore(c.subscribePlayback, c.playbackSnapshot);
  const position = c.player.position(), duration = c.player.duration;
  const progress = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  return <div className="timeline"><span id="elapsed">{time(position)}</span><input id="seek" aria-label="播放进度" type="range" min="0" max={duration || 1} step=".01" value={position} style={{ '--progress': `${progress.toFixed(2)}%` } as CSSProperties} disabled={c.loading || !c.player.buffers.length} onInput={e => c.seek(Number(e.currentTarget.value))} /><span id="duration">{time(duration)}</span></div>;
}

export function PlaybackStatus({ controller: c }: Props) {
  useSyncExternalStore(c.subscribePlayback, c.playbackSnapshot);
  const upcoming = c.upcomingSong;
  const label = c.autoStartSeconds > 0 ? `${c.autoStartSeconds} 秒后开始播放` : upcoming ? `下一首：${upcoming.title}` : c.status;
  return <span id="state" title={upcomingDetails(c)} aria-live="polite" aria-atomic="true">{label}</span>;
}

export function NextSongPreview({ controller: c }: Props) {
  useSyncExternalStore(c.subscribePlayback, c.playbackSnapshot);
  const upcoming = c.upcomingSong;
  return upcoming ? <div id="next-song" className="next-song-overlay" title={upcomingDetails(c)}>下一首：{upcoming.title}</div> : null;
}
