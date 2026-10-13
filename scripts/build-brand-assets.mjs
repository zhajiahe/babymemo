/** One vector master drives every launcher, browser, and brand asset. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
const source = readFileSync(resolve(publicDir, 'brand/icon-source.svg'), 'utf8');
function png(size) {
  return new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
}
const write = (name, content) => writeFileSync(resolve(publicDir, name), content);
const sizes = [16, 32, 48];
const favicons = sizes.map(png);
write('favicon-32.png', favicons[1]);
const ico = Buffer.alloc(6 + sizes.length * 16);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(sizes.length, 4);
let offset = ico.length;
for (let i = 0; i < sizes.length; i++) {
  const at = 6 + i * 16;
  ico[at] = sizes[i];
  ico[at + 1] = sizes[i];
  ico.writeUInt16LE(1, at + 4);
  ico.writeUInt16LE(32, at + 6);
  ico.writeUInt32LE(favicons[i].length, at + 8);
  ico.writeUInt32LE(offset, at + 12);
  offset += favicons[i].length;
}
write('favicon.ico', Buffer.concat([ico, ...favicons]));
write('apple-touch-icon.png', png(180));
write('icon-192.png', png(192));
write('icon-512.png', png(512));
write('icon-maskable-512.png', png(512));
write('brand/mark.svg', source);
write('favicon.svg', source);
const nested = source.replace(source.slice(0, source.indexOf('>') + 1), '<svg x="0" y="0" width="210" height="210" viewBox="0 0 1024 1024">');
write('brand/wordmark.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="950" height="220" viewBox="0 0 950 220" role="img" aria-label="BabyMemo 家庭成长日记"><title>BabyMemo</title>${nested}<text x="235" y="115" font-family="sans-serif" font-size="80" font-weight="700" fill="#243448">BabyMemo</text><text x="239" y="165" font-family="sans-serif" font-size="29" fill="#586D80">家庭成长日记</text></svg>\n`);
console.log('Generated BabyMemo icon assets from public/brand/icon-source.svg.');
