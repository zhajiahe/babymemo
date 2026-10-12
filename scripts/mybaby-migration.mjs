// Operator-only read-only preparation. Never bundled into the Worker.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir, chmod, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export const tables = ['babies', 'growth_records', 'milestones', 'media_items'];
const models = ['baby', 'growthRecord', 'milestone', 'mediaItem'];
const hash = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const contentHash = value => hash(JSON.stringify(canonical(value)));

// Matches the old UI's date.split('T')[0], not a timezone conversion.
export function legacyDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('invalid_source_date');
  const day = value.slice(0, 10);
  if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) throw Error('invalid_source_date');
  return day;
}

export function validateSnapshot(snapshot) {
  if (snapshot.version !== 1 || !Number.isFinite(Date.parse(snapshot.exportedAt))) throw Error('invalid_snapshot');
  for (const table of tables) {
    const rows = snapshot.rows?.[table];
    if (!Array.isArray(rows)) throw Error('invalid_snapshot');
    const ids = new Set();
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw Error('duplicate_or_invalid_source_id');
      ids.add(row.id);
      for (const field of ['createdAt', 'updatedAt', table === 'babies' ? 'birthDate' : 'date']) legacyDay(row[field]);
      if (table === 'babies' && !['boy', 'girl', 'other'].includes(row.gender)) throw Error('invalid_source_gender');
      if (table === 'milestones' && (!Array.isArray(row.tags) || row.tags.some(t => typeof t !== 'string'))) throw Error('invalid_source_tags');
      if (table === 'media_items' && (!['IMAGE', 'VIDEO'].includes(row.mediaType) || typeof row.url !== 'string' || !row.url)) throw Error('invalid_source_media');
    }
  }
  const ids = new Set(snapshot.rows.babies.map(row => row.id));
  for (const table of tables.slice(1)) if (snapshot.rows[table].some(row => !ids.has(row.babyId))) throw Error('invalid_source_relation');
  return Object.fromEntries(tables.map(table => [table, {
    count: snapshot.rows[table].length,
    hash: contentHash([...snapshot.rows[table]].sort((a, b) => a.id.localeCompare(b.id))),
  }]));
}

export function objectKey(reference, publicDomain) {
  if (typeof reference !== 'string' || !reference) throw Error('invalid_media_reference');
  let encoded;
  if (reference.startsWith('/api/media/')) encoded = reference.slice('/api/media/'.length);
  else {
    const domain = new URL(publicDomain), url = new URL(reference);
    const prefix = domain.pathname.replace(/\/$/, '') + '/';
    if (!['https:', 'http:'].includes(domain.protocol) || url.origin !== domain.origin || !url.pathname.startsWith(prefix) || url.username || url.password || url.search || url.hash) throw Error('unapproved_media_origin');
    encoded = url.pathname.slice(prefix.length);
  }
  const key = decodeURIComponent(encoded);
  if (!key || key.startsWith('/') || key.includes('\\') || /[\x00-\x1f\x7f?#]/.test(key) || key.split('/').some(p => !p || p === '.' || p === '..')) throw Error('invalid_media_key');
  return key;
}

export function mediaReferences(snapshot, publicDomain) {
  const objects = new Map();
  const add = (ref, table, id, field) => {
    if (ref === null || ref === undefined || ref === '') return;
    const key = objectKey(ref, publicDomain);
    if (!objects.has(key)) objects.set(key, {key, references: []});
    objects.get(key).references.push({table, id, field});
  };
  for (const row of snapshot.rows.babies) add(row.avatar, 'babies', row.id, 'avatar');
  for (const row of snapshot.rows.media_items) {
    add(row.url, 'media_items', row.id, 'url');
    add(row.thumbnailUrl, 'media_items', row.id, 'thumbnailUrl');
  }
  return [...objects.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function privateDirectory(path) {
  await mkdir(path, {recursive: true, mode: 0o700});
  await chmod(path, 0o700);
}
export async function save(path, data) {
  // No clobber: every run has an immutable, independently named snapshot.
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
}
export async function sourceConfiguration(source) {
  const env = parseEnv(await readFile(join(source, '.env'), 'utf8'));
  for (const name of ['DATABASE_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_PUBLIC_DOMAIN']) {
    if (!env[name]) throw Error('missing_source_configuration');
  }
  return env;
}

export async function exportSnapshot(client) {
  const rows = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const result = {};
    for (let i = 0; i < tables.length; i++) result[tables[i]] = await tx[models[i]].findMany({orderBy: {id: 'asc'}});
    return result;
  }, {isolationLevel: 'RepeatableRead', timeout: 120000});
  // Prisma Dates become ISO strings, without changing any source field.
  const snapshot = JSON.parse(JSON.stringify({version: 1, exportedAt: new Date().toISOString(), rows}));
  validateSnapshot(snapshot);
  return snapshot;
}

async function main() {
  const [command, sourceArg = '../my-baby', runArg] = process.argv.slice(2);
  if (!['export', 'inventory'].includes(command)) throw Error('usage_export_or_inventory_source_directory_optional_run_directory');
  const source = resolve(sourceArg);
  const env = await sourceConfiguration(source);
  const require = createRequire(join(source, 'package.json'));
  if (command === 'export') {
    if (runArg) throw Error('export_run_directory_is_automatically_generated');
    const directory = resolve('.migration-private', 'mybaby-' + Date.now());
    await privateDirectory(directory);
    const {PrismaClient} = require('@prisma/client');
    const client = new PrismaClient({datasourceUrl: env.DATABASE_URL, log: []});
    try {
      const snapshot = await exportSnapshot(client);
      await save(join(directory, 'source.json'), snapshot);
      const summary = validateSnapshot(snapshot);
      const references = mediaReferences(snapshot, env.R2_PUBLIC_DOMAIN);
      await save(join(directory, 'references.json'), references);
      await save(join(directory, 'export-report.json'), {version: 1, exportedAt: snapshot.exportedAt, tables: summary, referencedObjects: references.length, datePolicy: 'legacy-calendar-day'});
      console.log('Read-only snapshot:', directory);
      console.log('Counts:', JSON.stringify(Object.fromEntries(tables.map(t => [t, summary[t].count]))));
      console.log('Referenced R2 objects:', references.length);
    } finally {await client.$disconnect();}
  } else {
    if (!runArg) throw Error('inventory_requires_private_run_directory');
    const directory = resolve(runArg);
    if (!directory.startsWith(resolve('.migration-private') + '/')) throw Error('private_run_directory_required');
    const snapshot = JSON.parse(await readFile(join(directory, 'source.json'), 'utf8'));
    const summary = validateSnapshot(snapshot);
    const references = mediaReferences(snapshot, env.R2_PUBLIC_DOMAIN);
    const {S3Client, HeadObjectCommand} = require('@aws-sdk/client-s3');
    const client = new S3Client({region: 'auto', endpoint: env.R2_ENDPOINT, credentials: {accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY}});
    const objects = [];
    try {
      for (const ref of references) {
        let head;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {head = await client.send(new HeadObjectCommand({Bucket: env.R2_BUCKET_NAME, Key: ref.key})); break;}
          catch (error) {
            if (error.$metadata?.httpStatusCode === 404) throw Error('referenced_source_object_missing');
            if (attempt === 2) throw Error('source_object_head_failed');
            await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
          }
        }
        if (!Number.isSafeInteger(head.ContentLength) || head.ContentLength < 1 || !head.ETag) throw Error('invalid_source_object_metadata');
        objects.push({...ref, size: head.ContentLength, etag: head.ETag, mime: head.ContentType ?? null, lastModified: head.LastModified?.toISOString() ?? null});
      }
      await save(join(directory, 'inventory-' + Date.now() + '.json'), {version: 1, inspectedAt: new Date().toISOString(), sourceHash: contentHash(snapshot), tables: summary, objects});
      console.log('Read-only R2 inventory verified. Objects:', objects.length, 'Bytes:', objects.reduce((n, o) => n + o.size, 0));
      console.log('No target writes performed. ETags are metadata, not complete SHA-256 verification.');
    } finally {client.destroy();}
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // SDK/Prisma exceptions can contain SQL, object keys, credentials or PII.
    const code = /^P\d{4}$/.test(error?.code ?? '') ? error.code : 'private_error';
    console.error('MIGRATION_PREPARATION_FAILED:', code, '; private inputs and underlying errors are not logged.');
    process.exitCode = 1;
  });
}
