import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const worker=read('src/worker.ts');
const app=read('src/App.tsx');
const settings=read('src/features/settings/Settings.tsx');
const runner=read('src/thumbnail-repair.ts');
const decoder=read('src/media-upload.ts');
const styles=read('src/editorial.css');

test('backfill discovery remains private, bounded and defaults to legacy image-only mode',()=>{
 assert.match(worker,/app\.use\('\/api\/\*'/);
 assert.match(worker,/authenticated\(c\)/);
 assert.match(worker,/app\.get\('\/api\/media\/thumbnail-backfill'/);
 assert.match(worker,/const type=c\.req\.query\('type'\)\|\|'image'/);
 assert.match(worker,/type!=='image'&&type!=='all'/);
 assert.match(worker,/mime LIKE 'image\/%'/);
 assert.match(worker,/mime LIKE 'video\/%'/);
 assert.match(worker,/ORDER BY id LIMIT 10/);
 assert.match(worker,/thumbnail_ready=0/);
 assert.match(worker,/deleted_at IS NULL/);
});
test('settings action scans every baby, discloses browser lifecycle, and shows real progress',()=>{
 assert.match(settings,/一键后台修复全部封面/);
 assert.match(settings,/startThumbnailRepair\(state\.babies\.map\(item=>item\.id\)\)/);
 assert.match(settings,/pauseThumbnailRepair/);
 assert.match(settings,/useSyncExternalStore\(subscribeThumbnailRepair,getThumbnailRepairSnapshot\)/);
 assert.match(settings,/修复 \{coverRepair\.repaired\} 项 · 未修复 \{coverRepair\.failed\} 项/);
 assert.match(settings,/关闭应用或 iPhone 冻结页面后会暂停/);
 assert.match(styles,/\.thumbnail-repair-progress progress/);
});
test('opt-in thumbnail worker checkpoints each item, skips originals and resumes only signed in',()=>{
 assert.match(runner,/const key='babymemo-thumbnail-repair-v1'/);
 assert.match(runner,/const leaseKey='babymemo-thumbnail-repair-lease-v1'/);
 assert.match(runner,/const url='\/api\/media\/thumbnail-backfill\?type=all/);
 assert.match(runner,/await visible\(\)/);
 assert.match(runner,/const blob=item\.mime\.startsWith\('video\/'\)/);
 assert.match(runner,/createRemoteVideoThumbnail\(item\.id\)/);
 assert.match(runner,/createStoredThumbnail\(item\.id,item\.mime\)/);
 assert.match(runner,/method:'PUT',headers:\{'Content-Type':'image\/jpeg'\}/);
 assert.match(runner,/after:item\.id,processed:snapshot\.processed\+1/);
 assert.match(runner,/repaired:snapshot\.repaired\+Number\(ok\)/);
 assert.match(runner,/failed:snapshot\.failed\+Number\(!ok\)/);
 assert.match(runner,/sameBabies\(babyIds\)/);
 assert.match(app,/if\(mode==='app'&&state\)resumeThumbnailRepair/);
 assert.match(app,/clearThumbnailRepair\(\);await clearDevice\(\)/);
 assert.doesNotMatch(runner,/\/api\/upload\/start|\/api\/upload\/direct/);
});
test('remote video poster uses private streaming and range-capable video element',()=>{
 assert.match(decoder,/export async function createRemoteVideoThumbnail\(id:string\)/);
 assert.match(decoder,/video\.src='\/api\/media\/'\+encodeURIComponent\(id\)\+'\/content'/);
 assert.match(decoder,/video\.preload='auto'/);
 assert.match(decoder,/document\.body\.appendChild\(video\)/);
 assert.match(decoder,/await createVideoFrameThumbnail\(video\)/);
 assert.match(decoder,/video\.remove\(\)/);
 assert.match(worker,/Accept-Ranges':'bytes'/);
 assert.doesNotMatch(decoder.slice(decoder.indexOf('export async function createRemoteVideoThumbnail')),/await fetch\(/);
});
