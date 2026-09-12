import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';
import { fixture } from './fixtures.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'karaoke-auto-start-'));
try {
  await fixture(path.join(root, 'First.mp4'), 'Vocals', false, 20);
  await copyFile(path.join(root, 'First.mp4'), path.join(root, 'Second.mp4'));
  const { app, store } = await createApp(root, { webRoot: path.resolve('dist/web') });
  const server = await listen(app);
  // Exercise real click activation rather than disabling the browser's autoplay policy.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(serverUrl(server));
    await page.waitForFunction(() => window.karaoke?.songs.length === 2);
    for (const toggle of await page.locator('.album-toggle').all()) await toggle.click();
    const first = page.locator('.version').first();
    await first.locator('.queue-request').click();
    await page.waitForFunction(() => window.karaoke.autoStartSeconds > 0);
    assert.match(await page.locator('#state').innerText(), /秒后开始播放/);
    assert.equal(await page.evaluate(() => window.karaoke.player.playing), false);
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => window.karaoke.autoStartSeconds);
    const expected = await page.evaluate(() => {
      const c = window.karaoke, second = c.songs.find(s => s.id !== c.queue[0])!.id;
      c.add(second); c.moveUp(1); return second;
    });
    assert.ok(await page.evaluate(() => window.karaoke.autoStartSeconds) <= before);
    await page.waitForFunction(id => window.karaoke.player.playing && window.karaoke.current?.id === id, expected, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.karaoke.autoStartSeconds), 0);
    assert.equal(await page.evaluate(() => window.karaoke.queue.length), 1);
    await page.evaluate(() => { const c = window.karaoke; c.pause(); c.add(c.songs[0].id); });
    assert.equal(await page.evaluate(() => window.karaoke.autoStartSeconds), 0);
    // Once the previous song is at its end, adding a song starts a fresh countdown.
    await page.evaluate(() => { const c = window.karaoke; c.seek(c.player.duration); c.add(c.songs[0].id); });
    assert.ok(await page.evaluate(() => window.karaoke.autoStartSeconds) > 0);
    await page.evaluate(() => { const c = window.karaoke; while (c.queue.length) c.remove(0); });
    assert.equal(await page.evaluate(() => window.karaoke.autoStartSeconds), 0);
    await page.evaluate(() => window.karaoke.add(window.karaoke.songs[0].id));
    await page.click('#play');
    await page.waitForFunction(() => window.karaoke.player.playing && window.karaoke.queue.length === 0);
    assert.equal(await page.evaluate(() => window.karaoke.autoStartSeconds), 0);
    console.log('PASS: 10-second idle start, click activation, additions, reordered head, pause protection and cancellation.');
  } finally { await browser.close(); await closeServer(server); await store.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
