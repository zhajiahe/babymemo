// Authorized operator utility: never deployed; no public migration endpoint.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {readFile, writeFile, chmod, appendFile, stat, unlink} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sourceConfiguration, save, contentHash, tables, validateSnapshot} from './mybaby-migration.mjs';
import {buildPlan, importedTables, insertSQL, mergeBabySQL, assertNoConflicts, verifyPlan, assertPrivateBucket} from './mybaby-import-plan.mjs';

function wrangler(args) {
  try {return execFileSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args], {encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});}
  catch {throw Error('wrangler_command_failed');}
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function privateRun(value) {
  const path = resolve(value);
  if (!path.startsWith(resolve('.migration-private') + '/')) throw Error('private_run_directory_required');
  return path;
}
async function readJSON(file) {return JSON.parse(await readFile(file, 'utf8'));}
export async function streamDigest(stream, file) {
  const hash = createHash('sha256'); let size = 0;
  const controller = new AbortController();
  let timer;
  const heartbeat = () => {clearTimeout(timer); timer = setTimeout(() => controller.abort(), 60000); timer.unref();};
  heartbeat();
  const measure = new Transform({transform(chunk, encoding, callback) {heartbeat(); size += chunk.length; hash.update(chunk); callback(null, chunk);}});
  try {
    if (file) await pipeline(stream, measure, createWriteStream(file, {mode: 0o600}), {signal: controller.signal});
    else {
      measure.resume();
      await pipeline(stream, measure, {signal: controller.signal});
    }
    return {size, sha256: hash.digest('hex')};
  } finally {clearTimeout(timer);}
}
async function main() {
  const [command, runArg, inventoryArg, ...flags] = process.argv.slice(2);
  if (!['prepare', 'schema', 'copy', 'import', 'verify'].includes(command) || !runArg || !inventoryArg || flags.some(f => f !== '--execute')) throw Error('usage_command_private_run_inventory_optional_execute');
  const execute = flags.includes('--execute');
  const directory = privateRun(runArg), inventoryPath = privateRun(inventoryArg);
  const target = await readJSON(resolve('.migration-private/target.json'));
  if (target.version !== 1 || target.worker !== 'babymemo' || target.databaseName !== 'babymemo' || target.bucket !== 'babymemo-media' || !/^[a-f0-9]{32}$/.test(target.accountId) || !/^[a-f0-9-]{36}$/.test(target.databaseId) || new URL(target.origin).protocol !== 'https:') throw Error('invalid_target');
  const source = resolve('../my-baby'), env = await sourceConfiguration(source);
  if (env.R2_BUCKET_NAME === target.bucket) throw Error('independent_source_and_target_buckets_required');
  const snapshot = await readJSON(join(directory, 'source.json')), inventory = await readJSON(inventoryPath);
  validateSnapshot(snapshot);
  const credentials = JSON.parse(wrangler(['auth', 'token', '--json']));
  if (!credentials.token) throw Error('cloudflare_login_required');
  const token = credentials.token; // Memory only; never saved or printed.
  const base = `https://api.cloudflare.com/client/v4/accounts/${target.accountId}`;
  async function request(path, init = {}, missing = false) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), init.method === 'PUT' ? 180000 : 60000);
      try {
        response = await fetch(base + path, {...init, headers: {Authorization: 'Bearer ' + token, ...init.headers}, signal: controller.signal});
      } catch {
        if (attempt < 5 && init.method !== 'PUT') {await sleep(Math.min(16000, 1000 * 2 ** attempt)); continue;}
        throw Error('cloudflare_network_unavailable');
      } finally {clearTimeout(timer);}
      // Once headers arrive, streamDigest's idle watchdog governs downloads;
      // a healthy slow stream must not be aborted by a total duration limit.
      if (missing && response.status === 404) {await response.body?.cancel(); return null;}
      if (response.ok) return response;
      await response.body?.cancel();
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 5 && init.method !== 'PUT') {await sleep(Math.min(16000, 1000 * 2 ** attempt)); continue;}
      throw Error('cloudflare_http_' + response.status);
    }
  }
  async function api(path, body) {
    const response = await request(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const json = await response.json();
    if (!json.success) throw Error('cloudflare_api_failed');
    return json.result;
  }
  const dbPath = `/d1/database/${target.databaseId}`;
  async function query(sql) {
    const results = await api(dbPath + '/query', {sql});
    if (!Array.isArray(results) || results.some(r => !r.success)) throw Error('d1_query_failed');
    return results;
  }
  // Verify actual active binding and custom domain, not merely local config.
  const settings = await api(`/workers/scripts/${target.worker}/settings`);
  if (settings.bindings.find(b => b.name === 'DB')?.id !== target.databaseId || settings.bindings.find(b => b.name === 'MEDIA')?.bucket_name !== target.bucket) throw Error('actual_worker_bindings_mismatch');
  const domains = await api('/workers/domains');
  if (!domains.some(d => d.hostname === new URL(target.origin).hostname && d.service === target.worker)) throw Error('target_custom_domain_mismatch');
  const database = await api(dbPath);
  if (database.name !== target.databaseName) throw Error('target_database_name_mismatch');
  assertPrivateBucket(await api(`/r2/buckets/${target.bucket}/domains/managed`), await api(`/r2/buckets/${target.bucket}/domains/custom`));
  const health = await fetch(target.origin + '/api/health');
  if (!health.ok || !(await health.json()).ok) throw Error('target_health_failed');
  const bootstrap = await fetch(target.origin + '/api/bootstrap/status');
  if (!(await bootstrap.json()).initialized) throw Error('target_not_initialized');
  async function targetRows() {
    const existing = (await query("SELECT name FROM sqlite_master WHERE type='table'"))[0].results.map(r => r.name);
    const result = {};
    for (const table of [...importedTables, 'legacy_import_rows']) result[table] = existing.includes(table) ? (await query(`SELECT * FROM ${table}`))[0].results : [];
    return result;
  }
  const current = await targetRows();
  const plan = buildPlan(snapshot, inventory, current, env.R2_PUBLIC_DOMAIN);
  const summary = {sourceHash: plan.sourceHash, counts: Object.fromEntries(importedTables.map(t => [t, plan.rows[t].length])), objectCopies: plan.copies.length, originalObjects: inventory.objects.length, totalBytes: plan.copies.reduce((n, o) => n + o.size, 0), mergedBabies: plan.mergedBabies.length};
  console.log('Verified target and conflict-free plan:', JSON.stringify(summary));
  const marker = join(directory, 'target-prepared.json');
  if (command === 'prepare') {
    if (!execute) {console.log('DRY RUN: no target writes or backup export.'); return;}
    const config = join(directory, 'target-wrangler.json');
    await writeFile(config, JSON.stringify({name: target.worker, account_id: target.accountId, d1_databases: [{binding: 'DB', database_name: target.databaseName, database_id: target.databaseId, migrations_dir: resolve('migrations')}]}), {mode: 0o600});
    const backup = join(directory, 'target-before-import-' + Date.now() + '.sql');
    wrangler(['d1', 'export', 'DB', '--remote', '--config', config, '--output', backup]);
    await chmod(backup, 0o600);
    if ((await stat(backup)).size < 1) throw Error('target_backup_empty');
    const backupDigest = await streamDigest(createReadStream(backup));
    await save(marker, {version: 1, target, sourceHash: plan.sourceHash, inventoryHash: contentHash(inventory), backup, backupDigest, countsBefore: Object.fromEntries(importedTables.map(t => [t, current[t].length])), preparedAt: new Date().toISOString()});
    await save(join(directory, 'plan.json'), plan);
    console.log('Target D1 backup saved privately; source and target identity pinned.'); return;
  }
  const prepared = await readJSON(marker);
  if (prepared.sourceHash !== plan.sourceHash || prepared.inventoryHash !== contentHash(inventory) || contentHash(prepared.target) !== contentHash(target)) throw Error('prepared_target_or_source_changed');
  if (contentHash(await streamDigest(createReadStream(prepared.backup))) !== contentHash(prepared.backupDigest)) throw Error('target_backup_digest_mismatch');
  // Use the immutable plan established before schema defaults or imports changed the target.
  const fixedPlan = await readJSON(join(directory, 'plan.json'));
  if (fixedPlan.sourceHash !== plan.sourceHash || contentHash(fixedPlan.rows) !== contentHash(plan.rows) || contentHash(fixedPlan.archive) !== contentHash(plan.archive) || contentHash(fixedPlan.copies) !== contentHash(plan.copies)) throw Error('immutable_plan_mismatch');
  if (command === 'schema') {
    if (!execute) {console.log('DRY RUN: additive schema migration only.'); return;}
    const history = (await query('SELECT name FROM d1_migrations'))[0].results.map(r => r.name);
    for (const name of ['0001_initial.sql', '0002_uploads.sql', '0003_upload_fingerprints.sql', '0004_thumbnail_retention.sql']) if (!history.includes(name)) throw Error('unexpected_target_migration_history');
    wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', join(directory, 'target-wrangler.json')]);
    console.log('Additive compatibility migration applied. Existing Worker remains unchanged.'); return;
  }
  const journal = join(directory, 'copy-checkpoints.ndjson');
  let checkpoints = [];
  try {checkpoints = (await readFile(journal, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));} catch (error) {if (error.code !== 'ENOENT') throw error;}
  const confirmed = new Map(checkpoints.map(c => [c.targetKey, c]));
  const objectPath = key => `/r2/buckets/${target.bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  async function targetDigest(object, missing = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await request(objectPath(object.targetKey), {}, missing);
      if (!response) return null;
      try {return await streamDigest(response.body);}
      catch {
        if (attempt === 2) throw Error('target_object_read_interrupted');
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  if (command === 'copy') {
    if (!execute) {console.log('DRY RUN: no source download or target object write.'); return;}
    const require = createRequire(join(source, 'package.json'));
    const {S3Client, GetObjectCommand, HeadObjectCommand} = require('@aws-sdk/client-s3');
    const client = new S3Client({region: 'auto', endpoint: env.R2_ENDPOINT, credentials: {accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY}});
    let cursor = 0, completed = 0;
    let stopping = false;
    async function worker() {
      while (!stopping && cursor < fixedPlan.copies.length) {
        const object = fixedPlan.copies[cursor++];
        const file = join(directory, 'transfer-' + contentHash(object.targetKey) + '.bin');
        try {
          const head = await client.send(new HeadObjectCommand({Bucket: env.R2_BUCKET_NAME, Key: object.key}), {abortSignal: AbortSignal.timeout(30000)});
          if (head.ETag !== object.etag || head.ContentLength !== object.size) throw Error('source_object_changed_since_inventory');
          const previous = confirmed.get(object.targetKey);
          if (previous) {
            // This isolated prefix is not referenced by the app until import.
            // Retain the completed full-file verification instead of repeatedly
            // downloading all completed objects after a network interruption.
            // The separate verify phase rereads every target object in full.
            if (!/^[a-f0-9]{64}$/.test(previous.sha256) || previous.size !== object.size || previous.sourceETag !== object.etag || previous.sourceKey !== object.key) throw Error('copy_checkpoint_mismatch');
          } else {
            const original = await client.send(new GetObjectCommand({Bucket: env.R2_BUCKET_NAME, Key: object.key, IfMatch: object.etag}), {abortSignal: AbortSignal.timeout(120000)});
            const digest = await streamDigest(original.Body, file);
            if (digest.size !== object.size) throw Error('source_download_size_mismatch');
            if (object.jpeg) {
              const buffer = await readFile(file);
              if (buffer[0] !== 255 || buffer[1] !== 216 || buffer[2] !== 255 || buffer.at(-2) !== 255 || buffer.at(-1) !== 217) throw Error('invalid_source_jpeg_derivative');
            }
            const actual = await targetDigest(object, true);
            if (actual && (actual.size !== digest.size || actual.sha256 !== digest.sha256)) throw Error('target_object_conflict');
            if (!actual) {
              let uploaded = false;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const response = await request(objectPath(object.targetKey), {method: 'PUT', headers: {'Content-Type': object.mime ?? 'application/octet-stream', 'Content-Length': String(digest.size), 'If-None-Match': '*'}, body: createReadStream(file), duplex: 'half'});
                  await response.body?.cancel(); uploaded = true; break;
                } catch {
                  const recovered = await targetDigest(object, true);
                  if (recovered && recovered.size === digest.size && recovered.sha256 === digest.sha256) {uploaded = true; break;}
                  if (recovered) throw Error('target_object_conflict');
                  if (attempt < 2) await sleep(1000 * 2 ** attempt);
                }
              }
              if (!uploaded) throw Error('target_object_upload_failed');
            }
            const verified = await targetDigest(object);
            if (verified.size !== digest.size || verified.sha256 !== digest.sha256) throw Error('target_object_hash_mismatch');
            const checkpoint = {targetKey: object.targetKey, sourceKey: object.key, sourceETag: object.etag, ...digest, verifiedAt: new Date().toISOString()};
            await appendFile(journal, JSON.stringify(checkpoint) + '\n', {mode: 0o600}); confirmed.set(object.targetKey, checkpoint);
          }
          completed++;
          if (completed % 20 === 0 || completed === fixedPlan.copies.length) console.log('SHA-256 verified copied objects:', completed + '/' + fixedPlan.copies.length);
        } catch (error) {stopping = true; throw error;}
        finally {await unlink(file).catch(() => {});}
      }
    }
    try {
      const results = await Promise.allSettled([worker(), worker()]);
      const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
    } finally {client.destroy();}
    console.log('Media copy complete; originals and all referenced derivatives remain private.'); return;
  }
  for (const object of fixedPlan.copies) {
    const checkpoint = confirmed.get(object.targetKey);
    if (!checkpoint || checkpoint.size !== object.size || checkpoint.sourceETag !== object.etag) throw Error('verified_media_copy_required');
  }
  if (command === 'import') {
    if (!execute) {console.log('DRY RUN: insert-only records and guarded initialization baby merge.'); return;}
    assertNoConflicts(fixedPlan, current);
    for (const merged of fixedPlan.mergedBabies) await query(mergeBabySQL(merged.before, merged.after));
    for (const table of [...importedTables, 'legacy_import_rows']) {
      const rows = table === 'legacy_import_rows' ? fixedPlan.archive : fixedPlan.rows[table];
      for (let start = 0; start < rows.length; start += 20) await query(rows.slice(start, start + 20).map(row => insertSQL(table, row)).join('\n'));
    }
    console.log('Insert-only business import finished; administrator, settings and auth tables untouched.');
  } else {
    for (const object of fixedPlan.copies) {
      const digest = await targetDigest(object), checkpoint = confirmed.get(object.targetKey);
      if (digest.size !== object.size || digest.sha256 !== checkpoint.sha256) throw Error('final_target_object_hash_mismatch');
    }
  }
  const actual = await targetRows();
  const report = verifyPlan(fixedPlan, actual);
  if ((await query('PRAGMA foreign_key_check'))[0].results.length) throw Error('target_foreign_key_check_failed');
  // Verify additions only, retaining every unrelated target row.
  const counts = Object.fromEntries(importedTables.map(table => [table, actual[table].length]));
  for (const table of importedTables) {
    const originalIds = new Set(current[table].map(r => r.id));
    const additions = fixedPlan.rows[table].filter(r => !originalIds.has(r.id)).length;
    if (counts[table] !== current[table].length + additions) throw Error('unexpected_target_count_' + table);
  }
  for (const suffix of ['/api/state', '/api/media/' + fixedPlan.rows.media[0]?.id + '/content', '/api/media/' + fixedPlan.rows.media[0]?.id + '/thumbnail']) {
    const response = await fetch(target.origin + suffix);
    await response.body?.cancel();
    if (response.status !== 401) throw Error('private_media_authentication_failed');
  }
  const reportPath = join(directory, 'validation-' + Date.now() + '.json');
  await save(reportPath, {version: 1, validatedAt: new Date().toISOString(), sourceHash: fixedPlan.sourceHash, tables: report, counts, copiesVerified: fixedPlan.copies.length, mediaHashesRechecked: command === 'verify', foreignKeysValid: true, bucketPrivate: true, unauthenticatedRequestsRejected: true});
  console.log('Target fields, archived source fields, mappings, counts and foreign keys verified:', JSON.stringify(counts));
  console.log('Unauthenticated media/content/thumbnail access rejected. Report saved privately.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  // Only our own bounded error codes; underlying SDK errors are suppressed.
  const safe = error instanceof Error && /^(?:[a-z_]+(?:_\d{3})?)$/.test(error.message) ? error.message : 'private_error';
  console.error('MIGRATION_STOPPED:', safe, '(private input and underlying errors suppressed)'); process.exitCode = 1;
});
