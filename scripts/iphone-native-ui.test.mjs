import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const app=read('src/App.tsx');
const css=read('src/editorial.css');
const viewer=read('src/components/MediaViewer.tsx');

test('iPhone home screen and full viewport metadata',()=>{
 const html=read('index.html');
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/apple-mobile-web-app-capable" content="yes"/);
 assert.match(html,/apple-mobile-web-app-status-bar-style/);
 assert.match(read('public/site.webmanifest'),/"display": "standalone"/);
});

test('sticky family title, labeled tabs and iPhone safe areas',()=>{
 assert.match(app,/aria-label="底部主导航"/);
 assert.match(app,/className="mobile-nav-label"/);
 assert.match(app,/window\.scrollTo\(0,0\)/);
 assert.match(css,/\.topbar \{ position:sticky; top:0;/);
 assert.match(css,/padding:calc\(9px \+ env\(safe-area-inset-top\)\)/);
 assert.match(css,/padding:7px 10px calc\(7px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css,/\.media-viewer-header \{ padding:calc\(12px \+ env\(safe-area-inset-top\)\)/);
 assert.match(css,/\.mobile-nav button:active/);
 assert.match(app,/aria-label="返回首页"/);
 assert.match(app,/active==='moments'&&tab==='overview'/);
 assert.match(app,/if\(tab!==active\)\{setActive\(tab\);return;\}/);
 assert.match(css,/\.topbar\.has-back \.crumb/);
 assert.match(css,/\.topbar \.mobile-back-button/);
 assert.match(app,/window\.visualViewport/);
 assert.match(app,/window\.innerHeight-viewport!\.height>140/);
 assert.match(app,/document\.addEventListener\('focusin',syncKeyboard\)/);
 assert.match(css,/\.app\.keyboard-open \.mobile-nav/);
 assert.doesNotMatch(css,/\.app:has\(input/);
 assert.doesNotMatch(app,/aria-label="选择宝宝"/);
});

test('photo swipes require horizontal intent, honor bounds and skip videos',()=>{
 assert.match(viewer,/onTouchStart=\{startSwipe\}/);
 assert.match(viewer,/onTouchEnd=\{finishSwipe\}/);
 assert.match(viewer,/onTouchCancel=/);
 assert.match(viewer,/Math\.abs\(dx\)<60\|\|Math\.abs\(dx\)<Math\.abs\(dy\)\*1\.3/);
 assert.match(viewer,/if\(!start\|\|video\|\|saving/);
 assert.match(viewer,/dx<0&&index<count-1/);
 assert.match(viewer,/dx>0&&index>0/);
 assert.match(viewer,/<video (?:ref=\{videoRef\} )?key=\{item\.id\} src=\{src\} controls playsInline/);
 assert.match(viewer,/onKeyDown=\{handleViewerKey\}/);
 assert.match(viewer,/aria-keyshortcuts=\{video\?undefined:'ArrowLeft ArrowRight'\}/);
 assert.match(viewer,/aria-live="polite" aria-atomic="true"/);
 assert.match(viewer,/currentImageStatus==='loading'/);
 assert.match(viewer,/currentImageStatus==='error'/);
 assert.match(viewer,/media-swipe-hint/);
 assert.match(viewer,/aria-label="移入回收站"/);
 assert.match(css,/touch-action:pan-y/);
});

test('touch feedback retains keyboard and reduced-motion support',()=>{
 assert.match(css,/touch-action:manipulation/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(read('src/design-system.css'),/:focus-visible[\s\S]*outline: 3px solid var\(--bm-focus-ring\)/);
});
