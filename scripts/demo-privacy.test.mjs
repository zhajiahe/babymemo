import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('product preview is a React app using fictional data, not a legacy static mock',()=>{
 const html=read('demo.html');
 const entry=read('src/demo/main.tsx');
 const view=read('src/demo/Demo.tsx');
 const vite=read('vite.config.ts');
 assert.match(html,/src\/demo\/main\.tsx/);
 assert.match(entry,/import Demo from '.\/Demo'/);
 assert.match(entry,/editorial\.css/);
 assert.match(view,/const photos:Photo\[\]/);
 assert.match(view,/const moments=/);
 assert.match(view,/GrowthChart items={growth}/);
 assert.match(view,/photo-stories/);
 assert.match(view,/photo-grid/);
 assert.match(vite,/demo\.html/);
 assert.equal(existsSync(new URL('../public/demo.html',import.meta.url)),false);
});

test('product preview never reads family sessions or requests private data',()=>{
 const code=read('src/demo/Demo.tsx')+'\n'+read('src/demo/main.tsx');
 assert.doesNotMatch(code,/fetch\s*\(|XMLHttpRequest|\/api\/|localStorage|sessionStorage|startOffline\s*\(|\bpost\s*\(|workers\.dev|r2\.dev/i);
 assert.doesNotMatch(code,/from ['"]\.\.\/App['"]|<Album\b|<RecordView\b/);
 assert.match(code,/示例|虚构|fictional/i);
 assert.match(code,/referrerPolicy="no-referrer"/);
});
test('video play mark is visible on home and album thumbnails',()=>{const home=read('src/App.tsx'),album=read('src/features/album/Album.tsx');assert.match(home,/home-video-badge.*<Play/);assert.match(home,/home-thumb-video.*<Play/);assert.match(album,/video-play-badge.*<Play/);});
test('typed bootstrap response and resumable upload descriptor',()=>{assert.doesNotMatch(read('src/App.tsx'),/api<any>\('\/api\/bootstrap\/status'/);assert.doesNotMatch(read('src/features/album/Album.tsx'),/resumable:Record<string,any>/);});
