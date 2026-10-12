import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('common UI primitives are exported and imported only once', () => {
  assert.match(app, /from '\.\/components\/ui'/);
  for (const name of ['Logo','Notice','Field','Primary','Card','Pager']) {
    assert.match(shared, new RegExp('export function '+name+'\\('), 'export '+name);
    assert.doesNotMatch(app, new RegExp('function '+name+'\\('), 'no inline '+name);
  }
});

test('shared controls preserve basic accessibility semantics', () => {
  assert.match(shared, /className="notice" role="status"/);
  assert.match(shared, /aria-label="关闭提示"/);
  assert.match(shared, /className="primary" type="submit" disabled=\{disabled\}/);
  assert.match(shared, /<nav className="pager" aria-label="分页导航">/);
  assert.match(shared, /type="button" disabled=\{page <= 0\}/);
  assert.match(shared, /type="button" disabled=\{!hasMore\}/);
  assert.match(app, /aria-current=\{tab===active\?'page':undefined\}/);
});

test('core component backgrounds reference semantic design tokens', () => {
  for (const token of ['surface-alt','surface-soft','input-bg','border-soft']) {
    assert.match(css, new RegExp('--bm-'+token+':#[a-fA-F0-9]{6}'), 'token '+token);
  }
  for (const selector of ['.sidebar{','.card{','.topbar{','.secondary{''.photo-grid{','.wechat-row{']) {
    const start = css.indexOf(selector);
    assert.ok(start !== -1, 'selector '+selector);
    const declaration = css.slice(start, css.indexOf('}', start));
    assert.match(declaration, /var\(--bm-(?:surface|border|ink|muted)/, selector);
  }
});
