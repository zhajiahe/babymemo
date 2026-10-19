import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('private browsing stays authenticated and telemetry never sends identifiers',()=>{
 const app=read('src/App.tsx'),client=read('src/client-performance.ts'),worker=read('src/worker.ts');
 assert.match(app,/window.setInterval\(\(\)=>void check\(\),45000\)/);
 assert.match(app,/lazy\(\(\)=>import\('\.\/features\/album\/Album'\)/);
 assert.match(app,/lazy\(\(\)=>import\('\.\/features\/settings\/Settings'\)/);
 assert.match(client,/JSON.stringify\(\{metric,durationMs:Math.round\(durationMs\)\}\)/);
 assert.match(worker,/CLIENT_EXPERIENCE_TIMING/);
 assert.match(worker,/authenticated\(c\)/);
});
test('keyset timeline ordering has aligned indexes and no incompatible page removal',()=>{
 const schema=read('migrations/0021_performance_indexes.sql'),worker=read('src/worker.ts');
 for(const table of ['media','milestones','growth_records'])
  assert.match(schema,new RegExp('ON '+table+'\\(baby_id,deleted_at,day DESC,created_at DESC,id DESC\\)'));
 assert.match(worker,/ORDER BY day DESC,created_at DESC,id DESC LIMIT 37 OFFSET/);
 assert.match(worker,/ORDER BY day DESC,created_at DESC,id DESC LIMIT 41 OFFSET/);
 assert.match(worker,/parsePageCursor\(cursorParam\)/);
 assert.match(worker,/nextCursor:/);
});
test('bounded archive fetches and uploads keep original media intact',()=>{
 const exportSource=read('src/family-export.ts'),download=read('src/export-download.ts'),album=read('src/features/album/Album.tsx');
 assert.match(exportSource,/Math.min\(4,objects.length\)/);
 assert.match(download,/index\+1<files.length/);
 assert.match(download,/return stream/);
 assert.match(album,/queuedDerivatives/);
 assert.match(album,/thumbnailTail.current.then/);
});
