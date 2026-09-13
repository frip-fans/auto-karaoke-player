// All platform assets come from the same SVG. Requires the existing Playwright Chromium.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const source = await readFile(new URL('../src/renderer/public/icons/app.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const pngs = new Map();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`);
    pngs.set(size, await page.screenshot({ omitBackground: true }));
  }
} finally { await browser.close(); }
const assets = new URL('../assets/', import.meta.url);
await mkdir(assets, { recursive: true });
await writeFile(new URL('../src/renderer/public/icons/app.png', import.meta.url), pngs.get(512));
// ICO directory entries contain PNG images at every common Windows icon size.
const sizes = [16, 32, 48, 64, 128, 256];
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16, png = pngs.get(size);
  directory[entry] = directory[entry + 1] = size % 256;
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
}
await writeFile(new URL('app.ico', assets), Buffer.concat([directory, ...sizes.map(size => pngs.get(size))]));
// ICNS PNG chunks, including Retina resolutions.
const chunks = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([size, type]) => {
  const png = pngs.get(size), header = Buffer.alloc(8);
  header.write(type); header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(8 + chunks.reduce((n, chunk) => n + chunk.length, 0), 4);
await writeFile(new URL('app.icns', assets), Buffer.concat([header, ...chunks]));
console.log('Generated app.png, app.ico and app.icns from app.svg');
