/** Generate favicon, iOS, and PWA assets from the approved transparent BabyMemo icon. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
const source = readFileSync(resolve(publicDir, 'brand/baby-journal-source.png'));
const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');

function chunks(png) {
  if (!png.subarray(0, 8).equals(PNG_SIG)) throw Error('Invalid brand source PNG');
  const out = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += length + 12;
    if (type === 'IEND') break;
  }
  return out;
}
function decodePalettePng(buffer) {
  const list = chunks(buffer), header = list.find(c => c.type === 'IHDR')?.data;
  if (!header) throw Error('Missing PNG header');
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  if (header[8] !== 8 || header[9] !== 3 || header[12] !== 0) throw Error('Source must be noninterlaced 8-bit palette PNG');
  const palette = list.find(c => c.type === 'PLTE')?.data;
  const alpha = list.find(c => c.type === 'tRNS')?.data;
  if (!palette) throw Error('Missing PNG palette');
  const packed = inflateSync(Buffer.concat(list.filter(c => c.type === 'IDAT').map(c => c.data)));
  const rgba = Buffer.alloc(width * height * 4);
  let offset = 0, previous = Buffer.alloc(width);
  for (let y = 0; y < height; y++) {
    const filter = packed[offset++], current = Buffer.from(packed.subarray(offset, offset + width));
    offset += width;
    for (let x = 0; x < width; x++) {
      const a = x ? current[x - 1] : 0, b = previous[x], c = x ? previous[x - 1] : 0;
      let prediction = 0;
      if (filter === 1) prediction = a;
      else if (filter === 2) prediction = b;
      else if (filter === 3) prediction = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
        prediction = da <= db && da <= dc ? a : db <= dc ? b : c;
      } else if (filter !== 0) throw Error('Unsupported PNG filter ' + filter);
      current[x] = (current[x] + prediction) & 255;
      const i = current[x], from = i * 3, to = (y * width + x) * 4;
      rgba[to] = palette[from] ?? 0;
      rgba[to + 1] = palette[from + 1] ?? 0;
      rgba[to + 2] = palette[from + 2] ?? 0;
      rgba[to + 3] = alpha?.[i] ?? 255;
    }
    previous = current;
  }
  return { width, height, rgba };
}
const { width, height, rgba } = decodePalettePng(source);
function render(size, { background = null, fill = 0.88 } = {}) {
  const dst = Buffer.alloc(size * size * 4);
  const w = size * fill, h = w * height / width, left = (size - w) / 2, top = (size - h) / 2;
  const base = background && background.match(/^#[0-9a-fA-F]{6}$/) ? [1, 3, 5].map(i => parseInt(background.slice(i, i + 2), 16)) : null;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const idx = (y * size + x) * 4;
    if (base) { dst[idx] = base[0]; dst[idx + 1] = base[1]; dst[idx + 2] = base[2]; dst[idx + 3] = 255; }
    const fx = (x + 0.5 - left) * width / w - 0.5;
    const fy = (y + 0.5 - top) * height / h - 0.5;
    if (fx < -0.5 || fy < -0.5 || fx >= width - 0.5 || fy >= height - 0.5) continue;
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    let a = 0, r = 0, g = 0, b = 0;
    for (const [sx, sy, weight] of [[x0,y0,(1-tx)*(1-ty)], [x1,y0,tx*(1-ty)], [x0,y1,(1-tx)*ty], [x1,y1,tx*ty]]) {
      const p = (sy * width + sx) * 4, opacity = rgba[p + 3] / 255 * weight;
      a += opacity; r += rgba[p] * opacity; g += rgba[p + 1] * opacity; b += rgba[p + 2] * opacity;
    }
    if (a > 0) {
      const alpha = base ? 1 : a;
      const blend = base ? 1 - a : 0;
      dst[idx] = Math.round((r + (base?.[0] ?? 0) * blend) / alpha);
      dst[idx + 1] = Math.round((g + (base?.[1] ?? 0) * blend) / alpha);
      dst[idx + 2] = Math.round((b + (base?.[2] ?? 0) * blend) / alpha);
      dst[idx + 3] = Math.round(alpha * 255);
    }
  }
  return dst;
}
const crcTable = Array.from({length:256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  return c >>> 0;
});
function chunk(type, bytes) {
  const name = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  let crc = 0xffffffff;
  for (const v of Buffer.concat([name, bytes])) crc = crcTable[(crc ^ v) & 255] ^ (crc >>> 8);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, bytes, checksum]);
}
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);header.writeUInt32BE(size, 4);header[8] = 8;header[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([PNG_SIG, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level:9})), chunk('IEND', Buffer.alloc(0))]);
}
const write = (name, bytes) => writeFileSync(resolve(publicDir, name), bytes);
const faviconSizes = [16, 32, 48];
const favicons = faviconSizes.map(size => encodePng(size, render(size, {fill:0.96})));
write('favicon-32.png', favicons[1]);
const icoHeader = Buffer.alloc(6 + favicons.length * 16);
icoHeader.writeUInt16LE(1, 2);icoHeader.writeUInt16LE(favicons.length, 4);
let start = icoHeader.length;
favicons.forEach((bytes, i) => {
  const p = 6 + i * 16;icoHeader[p] = faviconSizes[i];icoHeader[p+1] = faviconSizes[i];
  icoHeader.writeUInt16LE(1,p+4);icoHeader.writeUInt16LE(32,p+6);
  icoHeader.writeUInt32LE(bytes.length,p+8);icoHeader.writeUInt32LE(start,p+12);start += bytes.length;
});
write('favicon.ico', Buffer.concat([icoHeader,...favicons]));
write('apple-touch-icon.png', encodePng(180, render(180,{background:'#EAF4FC',fill:0.79})));
write('icon-192.png', encodePng(192, render(192,{fill:0.88})));
write('icon-512.png', encodePng(512, render(512,{fill:0.88})));
write('icon-maskable-512.png', encodePng(512, render(512,{background:'#EAF4FC',fill:0.72})));
const dataUri = 'data:image/png;base64,' + source.toString('base64');
const svg = (size, body) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="BabyMemo 宝宝成长日记"><title>BabyMemo</title>' + body + '</svg>\n';
const image = '<image x="0" y="0" width="100%" height="100%" href="' + dataUri + '"/>';
write('brand/mark.svg',svg(192,image));
write('favicon.svg',svg(192,image));
write('brand/wordmark.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="950" height="220" viewBox="0 0 950 220" role="img" aria-label="BabyMemo 家庭成长日记"><title>BabyMemo</title><image x="0" y="0" width="210" height="210" href="' + dataUri + '"/><text x="235" y="115" font-family="sans-serif" font-size="80" font-weight="700" fill="#243448">BabyMemo</text><text x="239" y="165" font-family="sans-serif" font-size="29" fill="#586D80">家庭成长日记</text></svg>\n');
console.log('Generated transparent favicon/logo, 180px Apple touch icon, and 192/512px PWA icons.');
