import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const bytes=(name)=>readFileSync(new URL('../public/'+name,import.meta.url));
function size(b){return [b.readUInt32BE(16),b.readUInt32BE(20)];}
test('every generated brand bitmap has the required dimensions',()=>{
 const files=[['favicon-32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512]];
 for(const [name,n] of files){const b=bytes(name);assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.deepEqual(size(b),[n,n]);}
});
test('transparent source and favicon, opaque iOS and maskable variants',()=>{
 const src=bytes('brand/baby-journal-source.png'); assert.deepEqual(size(src),[192,192]);
 const png=bytes('icon-512.png');assert.equal(png[25],6,'generated PNG uses RGBA');
 assert.match(bytes('favicon.svg').toString('utf8'),/data:image\\/png;base64/);
 assert.match(bytes('brand/wordmark.svg').toString('utf8'),/BabyMemo/);
 const m=JSON.parse(bytes('site.webmanifest').toString('utf8'));
 assert.ok(m.icons.some(i=>i.purpose==='maskable'&&i.sizes==='512x512'));
 assert.equal(m.theme_color,'#F7FAFD');
});
