import test from 'node:test';
import assert from 'node:assert/strict';
import {contentHash, legacyDay, objectKey, validateSnapshot, mediaReferences, exportSnapshot} from './mybaby-migration.mjs';

const at = '2025-02-03T00:00:00.000Z';
function fixture() {
  return {version: 1, exportedAt: at, rows: {
    babies: [{id: 'baby-test', name: '合成宝宝', gender: 'girl', birthDate: at, createdAt: at, updatedAt: at, avatar: 'https://media.example.test/avatar.jpg'}],
    growth_records: [{id: 'growth-test', babyId: 'baby-test', date: at, createdAt: at, updatedAt: at}],
    milestones: [{id: 'milestone-test', babyId: 'baby-test', date: at, createdAt: at, updatedAt: at, tags: ['合成标签']}],
    media_items: [{id: 'media-test', babyId: 'baby-test', date: at, createdAt: at, updatedAt: at, mediaType: 'IMAGE', url: 'https://media.example.test/photos/a%20b.heic', thumbnailUrl: 'https://media.example.test/avatar.jpg'}],
  }};
}

test('legacy calendar day preserves old UI semantics near timezone boundaries', () => {
  assert.equal(legacyDay('2025-02-03T20:00:00.000Z'), '2025-02-03');
  assert.throws(() => legacyDay('2025-02-30T00:00:00.000Z'));
  assert.throws(() => legacyDay('not-a-date'));
});
test('canonical hashes ignore object property ordering', () => {
  assert.equal(contentHash({b: 2, a: {d: 3, c: null}}), contentHash({a: {c: null, d: 3}, b: 2}));
});
test('source graph and IDs are validated without exposing values', () => {
  assert.equal(validateSnapshot(fixture()).babies.count, 1);
  let source = fixture(); source.rows.babies.push({...source.rows.babies[0]});
  assert.throws(() => validateSnapshot(source), /duplicate_or_invalid_source_id/);
  source = fixture(); source.rows.media_items[0].babyId = 'missing';
  assert.throws(() => validateSnapshot(source), /invalid_source_relation/);
  source = fixture(); source.rows.milestones[0].tags = '[]';
  assert.throws(() => validateSnapshot(source), /invalid_source_tags/);
});
test('object references require approved domain or private old API path', () => {
  const domain = 'https://media.example.test/prefix';
  assert.equal(objectKey(domain + '/nested/a%20b.mov', domain), 'nested/a b.mov');
  assert.equal(objectKey('/api/media/nested/a.mov', domain), 'nested/a.mov');
  for (const ref of ['https://evil.example.test/prefix/a', 'https://media.example.test/other/a', domain + '/a?token=secret', '/api/media/%2e%2e/a', '/api/media/%2froot', '/api/media/a%00b', '/api/media/a%5cb', '/api/media/']) {
    assert.throws(() => objectKey(ref, domain));
  }
});
test('inventory includes avatars, originals and derivatives with duplicate references grouped', () => {
  const refs = mediaReferences(fixture(), 'https://media.example.test');
  assert.equal(refs.length, 2);
  assert.equal(refs.find(r => r.key === 'avatar.jpg').references.length, 2);
  assert.ok(refs.some(r => r.key === 'photos/a b.heic'));
});
test('export uses a repeatable read, read-only transaction and keeps every source field', async () => {
  const source = fixture(); source.rows.babies[0].bloodType = 'synthetic';
  const calls = [];
  const client = {$transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, 'RepeatableRead');
    const tx = {$executeRawUnsafe: async sql => calls.push(sql)};
    for (const [model, table] of [['baby', 'babies'], ['growthRecord', 'growth_records'], ['milestone', 'milestones'], ['mediaItem', 'media_items']]) {
      tx[model] = {findMany: async () => {assert.equal(calls[0], 'SET TRANSACTION READ ONLY'); return source.rows[table];}};
    }
    return callback(tx);
  }};
  const exported = await exportSnapshot(client);
  assert.equal(exported.rows.babies[0].bloodType, 'synthetic');
  assert.deepEqual(exported.rows, source.rows);
  assert.deepEqual(calls, ['SET TRANSACTION READ ONLY']);
});
