import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';
import { fixture } from './fixtures.js';

declare global {
  interface Window { renderProbe: { libraryReads: number; appUpdates: number; playbackUpdates: number } }
}
const root = await mkdtemp(path.join(os.tmpdir(), 'karaoke-rendering-'));
try {
  await fixture(path.join(root, 'Current.mp4'), 'Vocals', false, 60);
  const { app, store } = await createApp(root, { webRoot: path.resolve('dist/web') });
  await store.scan();
  const server = await listen(app);
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(serverUrl(server));
    await page.waitForFunction(() => window.karaoke?.songs.length === 1);
    await page.evaluate(() => {
      const c = window.karaoke;
      window.renderProbe = { libraryReads: 0, appUpdates: 0, playbackUpdates: 0 };
      // A large library with an instrumented, non-playing row detects render work,
      // including React renders that leave the DOM unchanged.
      const extra = Array.from({ length: 1000 }, (_, index) => ({ ...c.songs[0], id: `library-${index}`, title: `Library ${index}`, album: 'Large album' }));
      const title = extra[0].title;
      Object.defineProperty(extra[0], 'title', { get() { window.renderProbe.libraryReads++; return title; } });
      c.songs = [...c.songs, ...extra]; c.changed();
      c.subscribe(() => window.renderProbe.appUpdates++);
      c.subscribePlayback(() => window.renderProbe.playbackUpdates++);
    });
    await page.waitForFunction(() => document.querySelector('#library-count')?.textContent === '1001');
    const sample = () => page.evaluate(() => ({ ...window.renderProbe, seek: Number((document.querySelector('#seek') as HTMLInputElement).value) }));
    const idle = await sample(); assert.ok(idle.libraryReads > 0);
    await page.waitForTimeout(1200);
    assert.deepEqual(await sample(), idle, 'idle should not publish UI updates');

    await page.evaluate(() => window.karaoke.loadSong(window.karaoke.songs[0].id));
    await page.waitForFunction(() => window.karaoke.player.playing);
    await page.waitForTimeout(250);
    const playing = await sample();
    await page.waitForTimeout(1200);
    const progressed = await sample();
    assert.ok(progressed.seek > playing.seek + .7, 'timeline should advance');
    assert.ok(progressed.playbackUpdates > playing.playbackUpdates);
    assert.equal(progressed.appUpdates, playing.appUpdates, 'clock must not notify the whole app');
    assert.equal(progressed.libraryReads, playing.libraryReads, 'clock must not render library rows');

    // Cross the final-45-second boundary through time alone, without another action.
    await page.evaluate(() => { const c = window.karaoke; c.queue = [c.songs[1].id]; c.seek(14); });
    await page.waitForFunction(() => !document.querySelector('#next-song'));
    const beforePreview = await sample();
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '下一首：Library 0');
    assert.equal(await page.locator('#next-song').textContent(), '下一首：Library 0');
    assert.equal((await sample()).appUpdates, beforePreview.appUpdates);

    await page.evaluate(() => window.karaoke.pause());
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '已暂停');
    await page.waitForTimeout(250);
    const paused = await sample(); await page.waitForTimeout(1000);
    assert.deepEqual(await sample(), paused, 'paused UI should stay still');
    await page.locator('#seek').evaluate((input: HTMLInputElement) => { input.value = '8'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#elapsed')?.textContent === '0:08');
    await page.locator('#search').fill('Library 999');
    await page.waitForFunction(() => document.querySelectorAll('.song').length === 1);
    assert.equal(await page.locator('.song-title').textContent(), 'Library 999');
    assert.deepEqual(errors, []);
    console.log('PASS: 1,001-song library stays idle during playback ticks; progress, passive next-song preview, pause, seek and search update correctly.');
  } finally { await browser.close(); await closeServer(server); await store.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
