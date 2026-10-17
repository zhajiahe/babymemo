import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';

const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');

function boot(saved, osDark, storageThrows=false) {
 const root = {dataset:{},style:{}};
 let color;
 const document = {
  documentElement:root,
  querySelector: selector => selector === 'meta[name="theme-color"]' ? {setAttribute:(key,value)=>{if(key==='content')color=value}} : null
 };
 const localStorage = {getItem:()=>{if(storageThrows)throw Error('blocked');return saved}};
 const window = {matchMedia:()=>({matches:osDark})};
 runInNewContext(read('public/theme-init.js'), {document,localStorage,window});
 return {mode:root.dataset.theme,scheme:root.style.colorScheme,color};
}

test('theme bootstrap resolves system, explicit preference, and blocked storage before React', () => {
 assert.deepEqual(boot(null,false),{mode:'light',scheme:'light',color:'#F8F8F6'});
 assert.deepEqual(boot(null,true),{mode:'dark',scheme:'dark',color:'#101820'});
 assert.deepEqual(boot('dark',false),{mode:'dark',scheme:'dark',color:'#101820'});
 assert.deepEqual(boot('light',true),{mode:'light',scheme:'light',color:'#F8F8F6'});
 assert.equal(boot('invalid',true).mode,'dark');
 assert.equal(boot('dark',false,true).mode,'light');
});

test('all entry points apply theme before Vite, share tokens and expose a working selector', () => {
 for (const page of ['index.html','demo.html','demo/mobile.html']) {
  const html=read(page);
  assert.match(html, /<script src="\/theme-init\.js"><\/script>/);
  assert.ok(html.indexOf('/theme-init.js') < html.indexOf('type="module"'),page);
 }
 for (const entry of ['src/main.tsx','src/demo/main.tsx','src/demo/mobile-main.tsx']) {
  assert.match(read(entry),/import ['"](?:\.\/|\.\.\/)theme['"]/);
 }
 const tokens=read('src/design-system.css');
 assert.match(tokens,/:root\[data-theme="dark"\]/);
 for(const token of ['--bm-page','--bm-ink','--bm-muted','--bm-brand','--bm-border','--bm-photo-bg','--bm-chart-grid','--bm-glass-top','--bm-toast-bg']) {
  assert.match(tokens,new RegExp(token+':'));
 }
 const theme=read('src/theme.ts');
 assert.match(theme,/useSyncExternalStore/);
 assert.match(theme,/addEventListener\('storage'/);
 assert.match(theme,/addEventListener\('change'/);
 assert.match(theme,/document\.documentElement\.style\.colorScheme/);
 const selector=read('src/components/ThemeSelector.tsx');
 assert.match(selector,/SegmentedControl<ThemePreference>/);
 assert.match(selector,/setThemePreference/);
 assert.match(read('src/features/settings/Settings.tsx'),/<ThemeSelector\/>/);
 assert.match(read('src/demo/Demo.tsx'),/<ThemeSelector\/>/);
 assert.match(read('src/App.tsx'),/<ThemeSelector compact\/>/);
});

test('the no-flash bootstrap is pre-cached by the existing offline shell', () => {
 assert.match(read('scripts/build-offline-shell.mjs'),/['"]\/theme-init\\.js['"]/);
});

test('legibility-critical native forms, floating bars and status feedback use semantic surfaces', () => {
 const styles=read('src/styles.css'),editorial=read('src/editorial.css');
 assert.match(styles,/\.field input,\.field textarea,\.field select\{font-size:14px;background:var\(--bm-input-bg\)\}/);
 assert.match(editorial,/background:var\(--bm-glass-top\)/);
 assert.match(editorial,/background:var\(--bm-glass-bottom\)/);
 assert.match(editorial,/\.settings-ai-probe\.failed\{color:var\(--bm-error\);border-color:var\(--bm-error-border\);background:var\(--bm-error-soft\)/);
 assert.match(styles,/background:var\(--bm-toast-bg\);color:var\(--bm-toast-ink\)/);
});
