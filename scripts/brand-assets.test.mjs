import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const bytes = name => readFileSync(new URL('../public/' + name, import.meta.url));
const source = () => bytes('brand/icon-source.svg').toString('utf8');
const size = b => [b.readUInt32BE(16), b.readUInt32BE(20)];
test('brand assets generated at every platform dimension', () => {
  for (const [name, n] of [['favicon-32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512]]) {
    const b = bytes(name);
    assert.equal(b.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual(size(b), [n,n]);
  }
  assert.equal(bytes('favicon.ico').readUInt16LE(4), 3);
});
test('all branding comes from one editable SVG master', () => {
  assert.ok(source().includes('viewBox="0 0 1024 1024"'));
  assert.ok(source().includes('id="baby"'));
  assert.ok(source().includes('id="journal"'));
  assert.equal(bytes('favicon.svg').toString('utf8'), source());
  assert.equal(bytes('brand/mark.svg').toString('utf8'), source());
  assert.ok(bytes('brand/wordmark.svg').toString('utf8').includes('BabyMemo'));
  assert.ok(!bytes('brand/wordmark.svg').toString('utf8').includes('data:image/png;base64'));
  const app = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('/brand/mark.svg'));
  assert.ok(!app.includes('baby-journal-source.png'));
  const offline = readFileSync(new URL('./build-offline-shell.mjs', import.meta.url), 'utf8');
  assert.ok(!offline.includes('baby-journal-source.png'));
});
test('PWA assets share the same browser cache version', () => {
  const manifest = JSON.parse(bytes('site.webmanifest').toString('utf8'));
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512'));
  assert.ok(manifest.icons.some(i => i.src.includes('mark.svg') && i.type === 'image/svg+xml'));
  assert.equal(manifest.theme_color, '#F7FAFD');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const version = html.split('favicon.svg?v=')[1]?.split('"')[0];
  assert.ok(version);
  assert.ok(html.includes('apple-touch-icon.png?v=' + version));
  for (const icon of manifest.icons) assert.ok(icon.src.endsWith('?v=' + version), icon.src);
});
