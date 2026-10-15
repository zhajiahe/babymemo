import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const tokens = read('src/design-system.css');

test('design system tokens have one source of truth and load before page styles', () => {
  for (const token of ['--bm-page','--bm-story-surface','--bm-brand','--bm-radius-lg','--bm-touch-min','--bm-duration-fast']) {
    assert.match(tokens, new RegExp(token + ':'));
  }
  assert.doesNotMatch(read('src/styles.css').split('}')[0], /--bm-(?:page|brand|radius-lg)\s*:/);
  for (const entry of ['src/main.tsx','src/demo/main.tsx']) {
    const source = read(entry);
    assert.ok(source.indexOf('design-system.css') < source.indexOf('styles.css'), entry);
    assert.ok(source.indexOf('styles.css') < source.indexOf('editorial.css'), entry);
  }
});

test('demo and production reuse the same view switch and native media dialog', () => {
  const demo=read('src/demo/Demo.tsx'),album=read('src/features/album/Album.tsx');
  const viewer=read('src/components/MediaViewer.tsx'),demoCss=read('src/demo/demo.css');
  assert.match(demo, /<SegmentedControl className="album-view-switch"/);
  assert.match(album, /<SegmentedControl className="album-view-switch"/);
  assert.match(demo, /<dialog ref=\{dialogRef\} className="media-dialog demo-viewer"/);
  assert.match(viewer, /<dialog ref=\{dialogRef\} className="media-dialog"/);
  assert.doesNotMatch(demoCss, /\.demo-app \.photo-story\{box-shadow:none\}/);
  assert.doesNotMatch(demoCss, /\.demo-viewer-backdrop/);
});

test('growth chart, preview and shared controls consume 2.1 semantic tokens', () => {
  const growth=read('src/features/growth/RecordView.tsx');
  const preview=read('docs/assets/product-preview.svg');
  const ui=read('src/components/ui.tsx');
  assert.match(growth, /<SegmentedControl className="chart-tabs"/);
  assert.match(growth, /var\(--bm-chart-line\)/);
  assert.doesNotMatch(growth, /#[0-9a-fA-F]{6}/);
  assert.match(ui,/export function IconButton/);
  assert.match(ui,/export function StatusMessage/);
  assert.match(ui,/aria-busy=\{loading\|\|undefined\}/);
  assert.match(preview,/data-design-system="2.1"/);
  for(const [token,hex] of Object.entries({'--bm-page':'#F8F8F6','--bm-ink':'#263647','--bm-brand':'#245F91','--bm-border':'#E1E6E9'})){
    assert.ok(tokens.includes(token+': '+hex+';'),token);
    assert.ok(preview.includes(hex),token+' in static preview');
  }
});

test('legacy focus and motion rules are centralized, not duplicated per page', () => {
  const css=read('src/styles.css'),demoCss=read('src/demo/demo.css');
  assert.doesNotMatch(css, /^:focus-visible\{/m);
  assert.doesNotMatch(css, /\*\{animation:none!important/);
  assert.doesNotMatch(demoCss, /\.demo-app button:focus-visible/);
  assert.match(tokens,/focus-visible/);
  assert.match(tokens,/prefers-reduced-motion/);
});

test('interactive primitives preserve keyboard, pressed, touch and reduced motion states', () => {
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /export function SegmentedControl/);
  assert.match(ui, /aria-pressed=\{value===option.value\}/);
  assert.match(ui, /export function Button/);
  assert.match(tokens, /focus-visible/);
  assert.match(tokens, /prefers-reduced-motion/);
  assert.match(tokens, /min-height: var\(--bm-touch-min\)/);
});
