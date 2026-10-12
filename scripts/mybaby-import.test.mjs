import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {Readable} from 'node:stream';
import {buildPlan, insertSQL, mergeBabySQL, verifyPlan, assertNoConflicts, destinationKey} from './mybaby-import-plan.mjs';
import {contentHash} from './mybaby-migration.mjs';
import {streamDigest} from './mybaby-import.mjs';
const at = '2025-01-01T00:00:00.000Z';
function fixture() {
  const snapshot = {version: 1, exportedAt: at, rows: {
    babies: [{id: 'legacy-baby', name: '合成宝宝', birthDate: at, gender: 'boy', birthTime: '09:00', birthWeight: 3, allergies: null, notes: "synthetic ' note", avatar: 'https://media.example.test/avatar.png', createdAt: at, updatedAt: at}],
    growth_records: [{id: 'growth', babyId: 'legacy-baby', date: at, weight: 4, notes: '合成资料', createdAt: at, updatedAt: at}],
    milestones: [{id: 'milestone', babyId: 'legacy-baby', date: at, title: "synthetic ' milestone", description: null, tags: ['synthetic'], createdAt: at, updatedAt: at}],
    media_items: [{id: 'image', babyId: 'legacy-baby', date: at, title: 'synthetic', description: '原描述', url: 'https://media.example.test/original.heic', thumbnailUrl: 'https://media.example.test/preview.jpg', mediaType: 'IMAGE', format: 'HEIC', duration: null, createdAt: at, updatedAt: at}],
  }};
  const inventory = {version: 1, sourceHash: contentHash(snapshot), objects: [
    {key: 'avatar.png', size: 20, mime: 'image/png', etag: 'avatar'},
    {key: 'original.heic', size: 100, mime: 'image/heic', etag: 'original'},
    {key: 'preview.jpg', size: 10, mime: 'image/jpeg', etag: 'preview'},
  ]};
  const target = {babies: [{id: 'initialized-baby', name: '合成宝宝', birthday: '2025-01-01', gender: 'boy', time_zone: 'Asia/Shanghai', allergies: '', notes: '', created_at: at}], growth_records: [], milestones: [], media: [], legacy_import_rows: []};
  return {snapshot, inventory, target};
}
const planFor = ({snapshot, inventory, target}) => buildPlan(snapshot, inventory, target, 'https://media.example.test');
function database() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync('migrations/' + file, 'utf8'));
  return db;
}
function actual(db) {
  return Object.fromEntries(['babies', 'growth_records', 'milestones', 'media', 'legacy_import_rows'].map(t => [t, db.prepare('SELECT * FROM ' + t).all().map(r => ({...r}))]));
}
test('plan maps initialized baby, retains full source, copies avatar and original not thumbnail', () => {
  const data = fixture(), plan = planFor(data);
  assert.equal(plan.babyMap['legacy-baby'], 'initialized-baby');
  assert.equal(plan.rows.growth_records[0].baby_id, 'initialized-baby');
  assert.equal(plan.rows.babies[0].birth_weight, 3);
  assert.equal(plan.rows.media[0].object_key, destinationKey('original.heic'));
  assert.equal(plan.rows.media[0].size, 100);
  assert.equal(plan.rows.media[0].thumbnail_ready, 1);
  assert.ok(plan.copies.some(o => o.targetKey === 'private/thumbnails/image.jpg'));
  assert.deepEqual(JSON.parse(plan.archive[0].payload_json), data.snapshot.rows.babies[0]);
});
test('ambiguous identities, mismatching inventory and overwrites fail closed', () => {
  let data = fixture(); data.target.babies[0].name = '另一位合成宝宝';
  assert.throws(() => planFor(data), /unmatched_target_baby/);
  data = fixture(); data.inventory.sourceHash = 'wrong';
  assert.throws(() => planFor(data), /inventory_snapshot_mismatch/);
  data = fixture(); data.target.babies[0].notes = 'existing private note';
  assert.throws(() => planFor(data), /initialization_baby_data_conflict/);
  data = fixture(); data.target.growth_records.push({id: 'growth', baby_id: 'different'});
  assert.throws(() => planFor(data), /target_row_conflict/);
});
test('real SQLite additive schema, SQL escaping, foreign keys and idempotent import', () => {
  const data = fixture(), plan = planFor(data), db = database();
  db.exec(insertSQL('babies', data.target.babies[0]));
  const run = () => {
    db.exec(mergeBabySQL(plan.mergedBabies[0].before, plan.mergedBabies[0].after));
    for (const [table, rows] of Object.entries(plan.rows)) for (const row of rows) db.exec(insertSQL(table, row));
    for (const row of plan.archive) db.exec(insertSQL('legacy_import_rows', row));
  };
  run(); run();
  const result = actual(db);
  assert.equal(result.babies.length, 1);
  assert.equal(result.milestones[0].title, "synthetic ' milestone");
  assert.equal(result.legacy_import_rows.length, 4);
  assert.equal(verifyPlan(plan, result).media.count, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assertNoConflicts(plan, result);
  db.close();
});
test('concurrent baby edit is not overwritten by guarded merge', () => {
  const data = fixture(), plan = planFor(data), db = database();
  db.exec(insertSQL('babies', data.target.babies[0]));
  db.exec("UPDATE babies SET notes='concurrent synthetic edit'");
  db.exec(mergeBabySQL(plan.mergedBabies[0].before, plan.mergedBabies[0].after));
  assert.equal(db.prepare('SELECT notes FROM babies').get().notes, 'concurrent synthetic edit');
  db.close();
});
test('insert-only SQL cannot change a conflicting target row', () => {
  const db = database();
  const {target} = fixture();
  db.exec(insertSQL('babies', target.babies[0]));
  db.exec(insertSQL('babies', {...target.babies[0], name: 'must not overwrite'}));
  assert.equal(db.prepare('SELECT name FROM babies').get().name, '合成宝宝');
  assert.throws(() => insertSQL('owner', {id: 1}));
  db.close();
});
test('stream hashes cover every byte and verify lengths', async () => {
  const bytes = Buffer.from('synthetic file bytes');
  const actual = await streamDigest(Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]));
  assert.equal(actual.size, bytes.length);
  assert.equal(actual.sha256.length, 64);
  assert.deepEqual(actual, await streamDigest(Readable.from([bytes])));
});
