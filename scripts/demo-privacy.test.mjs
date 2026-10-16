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

test('README links to deployed interactive web and mobile demos instead of a mock screenshot',()=>{
 const readme=read('README.md');
 assert.match(readme,/https:\/\/babymemo\.zhajiahe1994\.workers\.dev\/demo\)/);
 assert.match(readme,/https:\/\/babymemo\.zhajiahe1994\.workers\.dev\/demo\/mobile\)/);
 assert.doesNotMatch(readme,/product-preview\.svg/);
 assert.equal(existsSync(new URL('../docs/assets/product-preview.svg',import.meta.url)),false);
});

test('mobile demo reuses real read-only Demo and avoids private API or nested mobile iframe',()=>{
 const mobile=read('src/demo/MobileDemo.tsx'),entry=read('src/demo/mobile-main.tsx');
 const html=read('demo/mobile.html'),vite=read('vite.config.ts');
 assert.match(html,/src\/demo\/mobile-main\.tsx/);
 assert.match(vite,/mobileDemo:.*demo\/mobile\.html/);
 assert.match(entry,/import MobileDemo from '.\/MobileDemo'/);
 assert.match(mobile,/if\(onPhone\)return <div className="mobile-demo-live"><Demo\/><\/div>/);
 assert.match(mobile,/src="\/demo\.html"/);
 assert.doesNotMatch(mobile+entry,/\/api\/|localStorage|sessionStorage|startOffline|XMLHttpRequest/);
});

test('clean demo URLs are built as HTML assets without Worker redirects',()=>{
 const vite=read('vite.config.ts'),wrangler=read('wrangler.jsonc');
 const worker=read('src/worker.ts');
 assert.match(vite,/mobileDemo:.*demo\/mobile\.html/);
 assert.match(vite,/demo:fileURLToPath/);
 assert.doesNotMatch(wrangler,/run_worker_first[^\n]*\/demo/);
 assert.doesNotMatch(worker,/app\.get\('\/demo/);
 assert.match(vite,/demo-clean-url-redirects/); // Local Vite also supports the same clean URLs.
});

test('demo retains real shared design primitives without enabling private changes',()=>{
 const demo=read('src/demo/Demo.tsx');
 assert.match(demo,/SegmentedControl/);
 assert.match(demo,/className="media-dialog demo-viewer"/);
 assert.match(demo,/dialog\.showModal\(\)/);
 assert.doesNotMatch(demo,/\/api\/|localStorage|sessionStorage/);
});
test('product preview never reads family sessions or requests private data',()=>{
 const code=read('src/demo/Demo.tsx')+'\n'+read('src/demo/main.tsx');
 assert.doesNotMatch(code,/fetch\s*\(|XMLHttpRequest|\/api\/|localStorage|sessionStorage|startOffline\s*\(|\bpost\s*\(|workers\.dev|r2\.dev/i);
 assert.doesNotMatch(code,/from ['"]\.\.\/App['"]|<Album\b|<RecordView\b/);
 assert.match(code,/示例|虚构|fictional/i);
 assert.match(code,/referrerPolicy="no-referrer"/);
});
test('screenshot-led home layout puts the real story ahead of thumbnails without fabricating missing stories',()=>{
 const demo=read('src/demo/Demo.tsx'),app=read('src/App.tsx'),editorial=read('src/editorial.css'),demoCss=read('src/demo/demo.css');
 assert.ok(demo.indexOf('home-story-highlight demo-story-highlight')<demo.indexOf('home-photo-strip'));
 assert.ok(app.indexOf('className="home-story-highlight"')<app.indexOf('home-photo-strip'));
 assert.match(app,/!!media\[0\]\.description\?\.trim\(\)/,'no fake story card when there is no description');
 assert.match(editorial,/\.home-story-highlight/);
 assert.match(editorial,/\.home-photo-cover \{ aspect-ratio:16\/9; \}/);
 assert.match(demoCss,/demo-note-project\{display:none\}/,'keep mobile introductory note compact');
});
test('album story is side-by-side on desktop, stacked on mobile, never truncated',()=>{
 const css=read('src/editorial.css'),demoCss=read('src/demo/demo.css');
 assert.match(css,/\.photo-stories \{ display:grid; grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.photo-story \{ display:grid; grid-template-columns:/);
 assert.match(css,/\.photo-story \{ display:block; \}/);
 assert.match(css,/\.photo-story \.photo-frame \{ height:auto; min-height:0; aspect-ratio:16\/10; \}/);
 assert.match(css,/\.photo-story-text \{ color:/);
 assert.doesNotMatch(css,/\.photo-story-text[^}]*-webkit-line-clamp/);
 assert.match(demoCss,/demo-viewer-controls \.secondary:not\(:disabled\)/);
});
test('video play mark is visible on home and album thumbnails',()=>{const home=read('src/App.tsx'),album=read('src/features/album/Album.tsx');assert.match(home,/home-video-badge.*<Play/);assert.match(home,/home-thumb-video.*<Play/);assert.match(album,/video-play-badge.*<Play/);});
test('typed bootstrap response and resumable upload descriptor',()=>{assert.doesNotMatch(read('src/App.tsx'),/api<any>\('\/api\/bootstrap\/status'/);assert.doesNotMatch(read('src/features/album/Album.tsx'),/resumable:Record<string,any>/);});
