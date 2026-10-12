import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const css=readFileSync(new URL('../src/styles.css', import.meta.url),'utf8');
function token(name){
 const value=css.match(new RegExp('--bm-'+name+':(#[0-9a-fA-F]{6})(?:;|})'));
 assert.ok(value,'missing color token --bm-'+name);
 return value[1];
}
function luminance(hex){
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 const [r,g,b]=rgb.map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
 return 0.2126*r+0.7152*g+0.0722*b;
}
function contrast(a,b){
 const [light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
 return (light+0.05)/(dark+0.05);
}
test('semantic palette preserves readable brand and supporting text',()=>{
 assert.ok(contrast(token('brand'),'#ffffff')>=4.5,'brand/white requires 4.5:1');
 assert.ok(contrast(token('muted'),token('surface'))>=4.5,'muted/surface requires 4.5:1');
 assert.ok(contrast(token('muted'),token('page'))>=4.5,'muted/page requires 4.5:1');
 assert.ok(contrast(token('error'),'#fff1ed')>=4.5,'error requires 4.5:1');
});
test('primary actions share the high-contrast brand token',()=>{
 for(const selector of ['.primary{','.upload-action{']){
  const start=css.indexOf(selector);
  assert.ok(start>=0,'missing '+selector);
  const block=css.slice(start,css.indexOf('}',start));
  assert.match(block,/background:var\(--bm-brand\)/);
  assert.match(block,/color:var\(--bm-on-brand\)/);
 }
 assert.match(css,/:focus-visible\{outline:3px solid var\(--bm-focus\)/);
});
test('new typography floor and responsive touch targets stay explicit',()=>{
 assert.doesNotMatch(css,/font-size:\s*(?:10|11)px\b/);
 assert.match(css,/:where\(\.primary,\.secondary,\.light-btn,\.text-btn,\.icon-btn,\.pager button,\.notice button,\.upload-action\)\{min-height:44px\}/);
 assert.match(css,/\.mobile-nav button\{min-height:48px;min-width:48px\}/);
 assert.match(css,/\.field input,\.field textarea,\.field select\{font-size:16px\}/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
