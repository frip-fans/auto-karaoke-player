import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'karaoke-audience-ui-'));
const { app, store } = await createApp(root, { webRoot: path.resolve('dist/web') });
const server = await listen(app), browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(`(() => {
    const overlay = Object.assign(new EventTarget(), { visible: true, getTitlebarAreaRect: () => new DOMRect(0, 0, innerWidth - 140, 40) });
    Object.defineProperty(navigator, 'windowControlsOverlay', { value: overlay, configurable: true });
  })();`);
  await page.goto(serverUrl(server) + '/display?session=ui-test');
  const button = page.locator('#audience-fullscreen'), bar = page.locator('#audience-titlebar');
  assert.equal(await bar.evaluate(n => getComputedStyle(n).getPropertyValue('-webkit-app-region')), 'drag');
  assert.equal(await button.evaluate(n => getComputedStyle(n).getPropertyValue('-webkit-app-region')), 'no-drag');
  const videoBox = (await page.locator('video').boundingBox())!, barBox = (await bar.boundingBox())!, buttonBox = (await button.boundingBox())!;
  assert.ok(videoBox.y >= barBox.y + barBox.height);
  assert.ok(buttonBox.x + buttonBox.width <= 1280 - 140);
  assert.ok(buttonBox.y < 44); assert.equal(await button.textContent(), '');
  await button.click(); await page.waitForFunction(() => !!document.fullscreenElement);
  assert.equal(await button.getAttribute('aria-label'), '退出全屏');
  assert.equal((await bar.boundingBox())!.height, 0);
  await button.click(); await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await button.getAttribute('aria-label'), '全屏');
  assert.ok((await bar.boundingBox())!.height >= 44);
  await page.mouse.move(300, 300);
  await page.locator('html').dispatchEvent('pointerleave');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#audience-fullscreen')!).opacity === '0', {}, { timeout: 1000 });
  assert.equal(await button.evaluate(n => getComputedStyle(n).pointerEvents), 'none');
  await page.mouse.move(320, 320);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#audience-fullscreen')!).opacity === '1');
  await page.screenshot({ path: '/tmp/karaoke-audience-titlebar.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: separate draggable black titlebar, caption spacing, icon-only fullscreen toggle and fast leave-to-hide behavior.');
} finally { await browser.close(); await closeServer(server); await store.close(); await rm(root, { recursive: true, force: true }); }
