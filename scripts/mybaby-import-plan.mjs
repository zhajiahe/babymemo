import {contentHash, legacyDay, objectKey, validateSnapshot} from './mybaby-migration.mjs';
import {createHash} from 'node:crypto';

export const importedTables = ['babies', 'growth_records', 'milestones', 'media'];
export const destinationKey = key => 'private/import-my-baby/' + createHash('sha256').update(key).digest('hex');
const nullable = value => value ?? null;
export function buildPlan(snapshot, inventory, target, publicDomain) {
  validateSnapshot(snapshot);
  if (inventory.version !== 1 || inventory.sourceHash !== contentHash(snapshot)) throw Error('inventory_snapshot_mismatch');
  const objects = new Map(inventory.objects.map(object => [object.key, object]));
  if (objects.size !== inventory.objects.length) throw Error('duplicate_inventory_key');
  const copies = inventory.objects.map(object => ({...object, targetKey: destinationKey(object.key)}));
  const asset = reference => {
    if (!reference) return null;
    const key = objectKey(reference, publicDomain);
    const object = objects.get(key);
    if (!object || !Number.isSafeInteger(object.size) || object.size < 1) throw Error('source_object_not_in_inventory');
    return {...object, targetKey: destinationKey(key)};
  };
  const babyMap = {}, mergedBabies = [];
  const rows = Object.fromEntries(importedTables.map(table => [table, []]));
  const sourceIds = new Set(snapshot.rows.babies.map(baby => baby.id));
  for (const baby of snapshot.rows.babies) {
    const sameId = target.babies.find(existing => existing.id === baby.id);
    const matches = target.babies.filter(existing => existing.name === baby.name && existing.birthday === legacyDay(baby.birthDate) && existing.gender === baby.gender);
    if (matches.length > 1 || sameId && (sameId.name !== baby.name || sameId.birthday !== legacyDay(baby.birthDate) || sameId.gender !== baby.gender)) throw Error('ambiguous_baby_identity');
    const existing = sameId ?? matches[0];
    if (existing && existing.id !== baby.id && sourceIds.has(existing.id)) throw Error('baby_mapping_collision');
    if (existing && target.babies.length > snapshot.rows.babies.length && !sameId) throw Error('ambiguous_initialization_baby');
    const id = existing?.id ?? baby.id;
    if (Object.values(babyMap).includes(id)) throw Error('baby_mapping_collision');
    babyMap[baby.id] = id;
    const mapped = {
      id, name: baby.name, birthday: legacyDay(baby.birthDate), gender: baby.gender,
      time_zone: existing?.time_zone ?? 'Asia/Shanghai', allergies: baby.allergies ?? '', notes: baby.notes ?? '',
      created_at: existing?.created_at ?? baby.createdAt,
      birth_time: nullable(baby.birthTime), birth_weight: nullable(baby.birthWeight), birth_height: nullable(baby.birthHeight),
      birth_head_circumference: nullable(baby.birthHeadCircumference), blood_type: nullable(baby.bloodType),
      avatar_object_key: asset(baby.avatar)?.targetKey ?? null, updated_at: baby.updatedAt,
    };
    if (existing) {
      for (const field of Object.keys(mapped)) {
        if (['updated_at', 'id', 'name', 'birthday', 'gender', 'created_at', 'time_zone'].includes(field)) continue;
        const current = existing[field];
        if (current !== undefined && current !== null && current !== '' && current !== mapped[field]) throw Error('initialization_baby_data_conflict');
      }
      mergedBabies.push({before: existing, after: mapped});
    }
    rows.babies.push(mapped);
  }
  // Do not silently create a second baby when the initialized profile differs.
  if (target.babies.some(b => !Object.values(babyMap).includes(b.id))) throw Error('unmatched_target_baby');
  for (const row of snapshot.rows.growth_records) {
    for (const field of ['weight', 'height', 'headCircumference']) if (row[field] != null && (typeof row[field] !== 'number' || !Number.isFinite(row[field]))) throw Error('invalid_source_measurement');
    rows.growth_records.push({id: row.id, baby_id: babyMap[row.babyId], day: legacyDay(row.date), weight: nullable(row.weight), height: nullable(row.height), head_circumference: nullable(row.headCircumference), notes: row.notes ?? '', created_at: row.createdAt, updated_at: row.updatedAt});
  }
  for (const row of snapshot.rows.milestones) rows.milestones.push({id: row.id, baby_id: babyMap[row.babyId], day: legacyDay(row.date), title: row.title, description: row.description ?? '', tags: JSON.stringify(row.tags), created_at: row.createdAt, updated_at: row.updatedAt});
  for (const row of snapshot.rows.media_items) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(row.id)) throw Error('invalid_media_id');
    const original = asset(row.url), thumbnail = asset(row.thumbnailUrl);
    const mime = original.mime?.split(';')[0].trim().toLowerCase();
    if (!/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm))$/.test(mime ?? '') || (row.mediaType === 'IMAGE') !== mime.startsWith('image/')) throw Error('unsupported_source_mime');
    const ready = row.mediaType === 'IMAGE' && thumbnail?.mime?.split(';')[0].trim().toLowerCase() === 'image/jpeg';
    if (ready) copies.push({...thumbnail, targetKey: 'private/thumbnails/' + row.id + '.jpg', jpeg: true});
    rows.media.push({id: row.id, baby_id: babyMap[row.babyId], day: legacyDay(row.date), title: row.title ?? '', object_key: original.targetKey, mime, size: original.size, created_at: row.createdAt, thumbnail_ready: ready ? 1 : 0, description: row.description ?? '', format: nullable(row.format), duration: nullable(row.duration), thumbnail_object_key: thumbnail?.targetKey ?? null, updated_at: row.updatedAt});
  }
  const archive = [];
  for (const table of Object.keys(snapshot.rows)) {
    if (!['babies', 'growth_records', 'milestones', 'media_items'].includes(table)) continue;
    for (const row of snapshot.rows[table]) archive.push({source_table: table, source_id: row.id, target_id: table === 'babies' ? babyMap[row.id] : row.id, payload_json: JSON.stringify(row), payload_sha256: contentHash(row), imported_at: snapshot.exportedAt});
  }
  const plan = {version: 1, sourceHash: contentHash(snapshot), babyMap, mergedBabies, rows, archive, copies};
  assertNoConflicts(plan, target);
  return plan;
}

export function rowEqual(expected, actual) {
  return !!actual && Object.entries(expected).every(([key, value]) => actual[key] === value);
}
export function assertNoConflicts(plan, target) {
  for (const table of importedTables) {
    const existing = new Map((target[table] ?? []).map(row => [row.id, row]));
    for (const row of plan.rows[table]) {
      const actual = existing.get(row.id);
      if (actual && !rowEqual(row, actual) && !(table === 'babies' && plan.mergedBabies.some(b => b.after.id === row.id && rowEqual(b.before, actual)))) throw Error('target_row_conflict_' + table);
    }
  }
  const archive = new Map((target.legacy_import_rows ?? []).map(row => [row.source_table + ':' + row.source_id, row]));
  for (const row of plan.archive) {
    const actual = archive.get(row.source_table + ':' + row.source_id);
    if (actual && !rowEqual(row, actual)) throw Error('target_archive_conflict');
  }
}
export function sqlValue(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || value.includes('\0')) throw Error('invalid_sql_value');
  return "'" + value.replaceAll("'", "''") + "'";
}
export function insertSQL(table, row) {
  if (![...importedTables, 'legacy_import_rows'].includes(table) || Object.keys(row).some(key => !/^[a-z_][a-z0-9_]*$/.test(key))) throw Error('unapproved_sql_identifier');
  return `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(sqlValue).join(',')}) ON CONFLICT DO NOTHING;`;
}
export function mergeBabySQL(before, after) {
  // Compare every preflight field so a concurrent profile edit is never overwritten.
  const changes = Object.entries(after).filter(([key]) => key !== 'id').map(([key, value]) => `${key}=${sqlValue(value)}`).join(',');
  const guard = Object.entries(before).map(([key, value]) => `${key} IS ${sqlValue(value)}`).join(' AND ');
  return `UPDATE babies SET ${changes} WHERE ${guard};`;
}
export function verifyPlan(plan, actual) {
  for (const table of importedTables) {
    const rows = new Map(actual[table].map(row => [row.id, row]));
    for (const expected of plan.rows[table]) if (!rowEqual(expected, rows.get(expected.id))) throw Error('target_verification_failed_' + table);
  }
  const archive = new Map(actual.legacy_import_rows.map(row => [row.source_table + ':' + row.source_id, row]));
  for (const expected of plan.archive) if (!rowEqual(expected, archive.get(expected.source_table + ':' + expected.source_id))) throw Error('target_archive_verification_failed');
  return Object.fromEntries(importedTables.map(table => [table, {count: plan.rows[table].length, hash: contentHash(plan.rows[table])}]));
}
