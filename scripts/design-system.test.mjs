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

test('interactive primitives preserve keyboard, pressed, touch and reduced motion states', () => {
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /export function SegmentedControl/);
  assert.match(ui, /aria-pressed=\{value===option.value\}/);
  assert.match(ui, /export function Button/);
  assert.match(tokens, /focus-visible/);
  assert.match(tokens, /prefers-reduced-motion/);
  assert.match(tokens, /min-height: var\(--bm-touch-min\)/);
});
