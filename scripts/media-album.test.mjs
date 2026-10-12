import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mediaDownloadHeader } from '../src/media-filename.mjs';

const worker = readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/features/album/Album.tsx', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../src/components/MediaViewer.tsx', import.meta.url), 'utf8');

test('download filenames use a safe ASCII fallback and encoded UTF-8 names', () => {
  const original = '宝宝的第一张照片.jpg';
  assert.equal(mediaDownloadHeader(original, 'image/jpeg'),
    'attachment; filename="babymemo.jpg"; filename*=UTF-8' + "''" + encodeURIComponent(original));
  const header = mediaDownloadHeader('bad\r\nX-Test: injected/../thing', 'video/quicktime');
  assert.doesNotMatch(header, /[\r\n]/);
  assert.doesNotMatch(header, /X-Test: injected/);
  assert.match(header, /^attachment; filename="babymemo.mov"; filename\*=UTF-8''/);
  assert.match(mediaDownloadHeader('', 'video/mp4'), /babymemo\.mp4/);
});

test('media metadata route is behind authentication and checks input', () => {
  assert.match(worker, /app\.use\('\/api\/\*'/);
  assert.match(worker, /app\.patch\('\/api\/media\/:id'/);
  assert.match(worker, /typeof v\.title!=='string'/);
  assert.match(worker, /!dayOk\(v\.day\)/);
  assert.match(worker, /UPDATE media SET title=\?,day=\? WHERE id=\?/);
  assert.match(worker, /mediaDownloadHeader\(row\.title,row\.mime\)/);
  assert.match(worker, /c\.req\.query\('download'\)==='1'/);
});

test('album preview uses native modal and private same-origin media URLs', () => {
  assert.match(app, /<MediaViewer/);
  assert.match(viewer, /<dialog ref=\{dialogRef\}/);
  assert.match(viewer, /dialog\.showModal\(\)/);
  assert.match(viewer, /onClose=\{onClose\}/);
  assert.match(viewer, /src \+ '\?download=1'/);
  assert.match(viewer, /onSave\(\{ title: title\.trim\(\), day \}\)/);
});
