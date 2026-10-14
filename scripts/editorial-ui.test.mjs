import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const bytes=(path)=>readFileSync(new URL('../'+path,import.meta.url));
const text=(path)=>bytes(path).toString('utf8');
const app=text('src/App.tsx'),album=text('src/features/album/Album.tsx');
const viewer=text('src/components/MediaViewer.tsx'),css=text('src/editorial.css');
const manifest=JSON.parse(text('public/site.webmanifest'));

test('home is a real-media journal, without marketing dashboard ornaments',()=>{
 assert.match(app,/className="home-photo-cover"/);
 assert.match(app,/api\/media\/.*thumbnail/);
 assert.match(app,/className="home-measurements"/);
 assert.match(app,/className="home-events"/);
 assert.doesNotMatch(app,/OUR LITTLE STORY|今天也在闪闪发光|className="stats"/);
 assert.match(css,/\.welcome,\.stats \{ display:none!important/);
});

test('album is a compact photo grid with actions in the native details dialog',()=>{
 assert.match(album,/className="photo-grid"/);
 assert.doesNotMatch(album,/className="photo-caption"/);
 assert.doesNotMatch(album,/onFavorite=|favoriteOnly|仅看收藏/);
 assert.match(album,/onDelete=/);
 assert.match(viewer,/aria-label="移入回收站"/);
 assert.doesNotMatch(viewer,/onFavorite|收藏/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('favicon and all PWA assets decode with expected PNG headers and dimensions',()=>{
 assert.deepEqual(manifest.icons.filter(i=>i.type==='image/png').map(i=>i.sizes),['192x192','512x512','512x512']);
 for(const [file,size] of [['favicon-32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512]]){
  const b=bytes('public/'+file);
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(b.readUInt32BE(16),size);
  assert.equal(b.readUInt32BE(20),size);
 }
 const ico=bytes('public/favicon.ico');
 assert.equal(ico.readUInt16LE(2),1);
 assert.ok(ico.readUInt16LE(4)>=2);
 assert.equal(text('public/brand/mark.svg'),text('public/brand/icon-source.svg'));
 assert.equal(text('public/favicon.svg'),text('public/brand/icon-source.svg'));
 assert.match(text('public/brand/mark.svg'),/id="baby"/);
 assert.match(text('public/brand/mark.svg'),/id="journal"/);
});

test('family name and Settings-only baby switch remain available on mobile',()=>{
 const settings=text('src/features/settings/Settings.tsx');
 const worker=text('src/worker.ts');
 const harness=text('src/wechat-harness.mjs');
 assert.match(app,/className="space-name"/);
 assert.match(app,/className="side-label side-space-name"/);
 assert.match(css,/\.topbar \{ position:sticky; top:0; z-index:60; display:flex;/);
 assert.doesNotMatch(css,/\.topbar \{ display:none;/);
 assert.doesNotMatch(app,/aria-label="选择宝宝"/);
 assert.match(settings,/className="settings-baby-switch"/);
 assert.match(settings,/aria-label="选择宝宝"/);
 assert.doesNotMatch(worker,/app\.post\('\/api\/media\/:id\/favorite'/);
 assert.doesNotMatch(harness,/changes\.favorite|favorite:\{type:'boolean'\}/);
});
