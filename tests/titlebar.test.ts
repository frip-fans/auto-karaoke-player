import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp, listen, serverUrl, closeServer } from '../src/server/app.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'karaoke-titlebar-'));
const { app, store } = await createApp(root, { webRoot: path.resolve('dist/web') });
const server = await listen(app);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(`(() => {
    let reserved = 140;
    const overlay = Object.assign(new EventTarget(), { visible: true, getTitlebarAreaRect: () => new DOMRect(0, 0, innerWidth - reserved, 44) });
    Object.defineProperty(navigator, 'windowControlsOverlay', { value: overlay, configurable: true });
    window.addEventListener('test-caption', event => { reserved = event.detail; overlay.visible = reserved > 0; overlay.dispatchEvent(new Event('geometrychange')); });
  })();`);
  await page.goto(serverUrl(server));
  await page.waitForFunction(() => !!window.karaoke?.folder);
  async function assertSafe(reserved: number) {
    const width = page.viewportSize()!.width;
    for (const selector of ['#display', '#import-open', '.settings-trigger']) {
      const box = (await page.locator(selector).boundingBox())!;
      assert.ok(box.x + box.width <= width - reserved - 10, `${selector} overlaps native controls: ${JSON.stringify({box,width,reserved,header:await page.locator('header').evaluate(h=>({width:h.getBoundingClientRect().width,padding:getComputedStyle(h).paddingRight,children:[...h.children].map(c=>({name:c.className,width:c.getBoundingClientRect().width}))}))})}`);
      assert.ok(box.x >= 0 && box.width > 0, `${selector} is clipped`);
    }
    await page.locator('.settings-trigger').click();
    assert.equal(await page.locator('.settings-popover').evaluate((details: HTMLDetailsElement) => details.open), true);
    await page.locator('.settings-close').click();
  }
  await assertSafe(140);
  await page.setViewportSize({ width: 760, height: 900 }); await assertSafe(140);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-caption', { detail: 190 })));
  await assertSafe(190);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/tmp/karaoke-titlebar-safe.png' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-caption', { detail: 0 })));
  assert.equal(await page.locator('header').evaluate(header => parseFloat(getComputedStyle(header).paddingRight)), 28);
  assert.deepEqual(errors, []);
  console.log('PASS: titlebar controls stay clickable across resize, caption geometry changes and overlay removal.');
} finally { await browser.close(); await closeServer(server); await store.close(); await rm(root, { recursive: true, force: true }); }
