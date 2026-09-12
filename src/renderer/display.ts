import { installTitlebarInsets } from './titlebar';
import type { PlaybackState } from '../shared/types';
import './next-song.css';
const disposeTitlebarInsets = installTitlebarInsets();
const fullscreenButton = document.querySelector<HTMLButtonElement>('#audience-fullscreen')!;
const video = document.querySelector('video')!;
const hint = document.querySelector<HTMLElement>('#hint')!;
const upcoming = document.querySelector<HTMLElement>('#next-song')!;
function updateUpcoming() {
  const song = state?.playing ? state.upcoming : null;
  upcoming.hidden = !song;
  upcoming.textContent = song ? `下一首：${song.title}` : '';
  upcoming.title = song ? [song.title, song.artist, song.version].filter(Boolean).join(' · ') : '';
}
const channel = new BroadcastChannel('karaoke-' + new URLSearchParams(location.search).get('session'));
let state: PlaybackState | null = null;
let receivedAt = 0, lastSent = -Infinity, lastSeek = -Infinity, lastRequest = 0, forceSeek = false, playPending = false;
let idle: ReturnType<typeof setTimeout>;
const now = () => performance.timeOrigin + performance.now();
function message(text: string) { hint.textContent = text; hint.style.display = 'grid'; }
function play() {
  if (!video.paused || playPending || !state?.playing || video.readyState < 1) return;
  playPending = true;
  void video.play().catch(error => {
    if (error.name !== 'AbortError') message('点击画面以开始显示');
  }).finally(() => { playPending = false; });
}
function sync() {
  if (!state?.song) return;
  if (window.opener?.closed) { upcoming.hidden = true; video.pause(); message('控制窗口已关闭'); return; }
  // Keep playing through delayed heartbeats (e.g. a hidden controller or native dialog).
  if (performance.now() - receivedAt > 2000 && performance.now() - lastRequest > 2000) { lastRequest = performance.now(); channel.postMessage({ kind: 'ready' }); }
  const duration = Number.isFinite(video.duration) ? video.duration : state.song.duration;
  const target = Math.max(0, Math.min(duration, state.position + (state.playing ? Math.max(0, (now() - state.sent) / 1000) : 0)));
  video.muted = true;
  if (!state.playing && !video.paused) video.pause();
  if (video.readyState < 1) return;
  const drift = target - video.currentTime;
  // Let an in-flight seek finish. Seeking every animation frame can starve decoding.
  if (!video.seeking && (forceSeek || Math.abs(drift) > (state.playing ? .35 : .04))) {
    if (forceSeek || performance.now() - lastSeek >= 700) {
      forceSeek = false;
      if (Math.abs(drift) > .025) { lastSeek = performance.now(); video.currentTime = target; }
    }
  }
  video.playbackRate = state.playing && !video.seeking && Math.abs(drift) > .05 && Math.abs(drift) < .35 ? 1 + Math.sign(drift) * .03 : 1;
  if (state.playing && target < duration - .025) play();
}
channel.onmessage = event => {
  if (event.data.kind === 'closed') { state = null; updateUpcoming(); video.pause(); message('控制窗口已关闭'); return; }
  if (event.data.kind !== 'state') return;
  const update = event.data as PlaybackState;
  if (!Number.isFinite(update.sent) || update.sent < lastSent || !Number.isFinite(update.position)) return;
  lastSent = update.sent;
  forceSeek ||= update.revision !== state?.revision || update.song?.id !== state?.song?.id;
  state = update; receivedAt = performance.now();
  updateUpcoming();
  if (!state.song) { video.pause(); message('等待点歌…'); return; }
  if (video.dataset.song !== state.song.id) {
    video.dataset.song = state.song.id; video.src = '/video/' + encodeURIComponent(state.song.id); lastSeek = -Infinity;
  }
  hint.style.display = 'none';
  sync(); // Transport state must be applied even when requestAnimationFrame is suspended.
};
function reconnect() { forceSeek = true; channel.postMessage({ kind: 'ready' }); sync(); }
for (const event of ['loadedmetadata', 'canplay', 'seeked']) video.addEventListener(event, sync);
window.addEventListener('focus', reconnect);
window.addEventListener('pageshow', reconnect);
document.addEventListener('visibilitychange', reconnect);
// rAF may stop while a native window is occluded/minimized. Keep transport on a timer.
const timer = setInterval(sync, 100);
function showControls(delay = 1500) {
  document.body.classList.remove('idle'); clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('idle'), delay);
}
function hideControlsSoon() { clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 300); }
function updateFullscreen() {
  const fullscreen = !!document.fullscreenElement;
  document.body.classList.toggle('is-fullscreen', fullscreen);
  fullscreenButton.title = fullscreen ? '退出全屏' : '全屏';
  fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
  fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
  showControls(); reconnect();
}
fullscreenButton.onclick = async event => {
  event.stopPropagation();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { message('无法切换全屏，请重试'); }
};
document.addEventListener('fullscreenchange', updateFullscreen);
document.querySelector('#audience-stage')!.addEventListener('click', play);
document.addEventListener('pointermove', () => showControls());
document.documentElement.addEventListener('pointerenter', () => showControls());
document.documentElement.addEventListener('pointerleave', hideControlsSoon);
window.addEventListener('blur', hideControlsSoon);
window.addEventListener('focus', () => showControls());
fullscreenButton.addEventListener('focus', () => showControls());
window.addEventListener('beforeunload', () => { clearInterval(timer); clearTimeout(idle); disposeTitlebarInsets(); channel.close(); video.pause(); });
channel.postMessage({ kind: 'ready' });
updateFullscreen();
