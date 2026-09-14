import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';
import { fixture } from './fixtures.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'karaoke-next-song-'));
try {
  await fixture(path.join(root, 'Current.mp4'), 'Vocals', false, 60);
  await copyFile(path.join(root, 'Current.mp4'), path.join(root, 'Next.mp4'));
  await copyFile(path.join(root, 'Current.mp4'), path.join(root, 'Later.mp4'));
  const { app, store } = await createApp(root, { webRoot: path.resolve('dist/web') });
  await store.scan();
  const server = await listen(app);
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await page.context().addInitScript(() => { if (location.pathname === '/display') window.requestAnimationFrame = () => 0; });
    await page.goto(serverUrl(server));
    await page.waitForFunction(() => window.karaoke?.songs.length === 3);
    await page.evaluate(async () => {
      const c = window.karaoke;
      // Identical synthetic bytes can inherit fingerprint metadata; give each entry its own title.
      for (const name of ['Current', 'Next', 'Later']) {
        const song = c.songs.find(s => s.file === `${name}.mp4`)!;
        await c.api(`/api/songs/${song.id}`, 'PATCH', { title: name });
      }
      await c.refresh();
      c.add(c.songs.find(s => s.title === 'Next')!.id);
      c.add(c.songs.find(s => s.title === 'Later')!.id);
      await c.loadSong(c.songs.find(s => s.title === 'Current')!.id);
    });
    await page.waitForFunction(() => window.karaoke.player.playing);
    assert.equal(await page.locator('#state').textContent(), '播放中');
    const popupPromise = page.waitForEvent('popup');
    await page.click('#display');
    const popup = await popupPromise;
    await popup.waitForSelector('video');
    const preview = async (title: string | null) => {
      for (const target of [page, popup]) {
        await target.waitForFunction(expected => {
          const overlay = document.querySelector<HTMLElement>('#next-song');
          return expected === null ? !overlay || overlay.hidden : !!overlay && !overlay.hidden && overlay.textContent === `下一首：${expected}`;
        }, title);
      }
    };
    await preview(null);
    await page.evaluate(() => window.karaoke.seek(16));
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '下一首：Next');
    await preview('Next');
    const overlaySize = () => page.locator('#next-song').evaluate(el => ({ font: parseFloat(getComputedStyle(el).fontSize), width: el.parentElement!.clientWidth }));
    const windowed = await overlaySize();
    await page.click('#fullscreen');
    await page.waitForFunction(() => document.fullscreenElement?.id === 'stage');
    assert.equal(await page.locator(':fullscreen #next-song').count(), 1);
    const fullscreen = await overlaySize();
    assert.ok(fullscreen.font > windowed.font);
    assert.ok(Math.abs(fullscreen.font / windowed.font - fullscreen.width / windowed.width) < .05);
    await page.evaluate(() => document.exitFullscreen());
    await popup.click('#audience-fullscreen');
    await popup.waitForFunction(() => !!document.fullscreenElement);
    assert.equal(await popup.locator(':fullscreen #next-song').isVisible(), true);
    await popup.evaluate(() => document.exitFullscreen());
    await popup.setViewportSize({ width: 640, height: 480 });
    const smallFont = await popup.locator('#next-song').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await popup.setViewportSize({ width: 1920, height: 1080 });
    const largeFont = await popup.locator('#next-song').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(Math.abs(largeFont / smallFont - 3) < .05);
    assert.ok(largeFont >= 48);
    await page.evaluate(() => window.karaoke.moveUp(1));
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '下一首：Later');
    await preview('Later');
    await page.evaluate(() => window.karaoke.pause());
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '已暂停');
    await preview(null);
    await page.evaluate(() => window.karaoke.play());
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '下一首：Later');
    await preview('Later');
    await page.evaluate(() => window.karaoke.seek(5));
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '播放中');
    await preview(null);
    await page.evaluate(() => window.karaoke.seek(16));
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '下一首：Later');
    await preview('Later');
    await page.evaluate(() => window.karaoke.remove(0));
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '下一首：Next');
    await preview('Next');
    await page.evaluate(() => window.karaoke.remove(0));
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === '播放中');
    await preview(null);
    console.log('PASS: next-song previews on controller and audience, fullscreen, final 45 seconds, queue changes, pause and seeking.');
  } finally { await browser.close(); await closeServer(server); await store.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
