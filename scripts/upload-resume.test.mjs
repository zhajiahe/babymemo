import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {pickMatchingUpload,remainingPartNumbers} from '../src/upload-plan.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const worker=read('src/worker.ts'),ui=read('src/App.tsx');
const migration=read('migrations/0003_upload_fingerprints.sql');

test('resumption skips only confirmed parts, ignores duplicates and invalid parts',()=>{
 assert.deepEqual(remainingPartNumbers(4,[1,3,3,0,7]),[2,4]);
 assert.deepEqual(remainingPartNumbers(3,[1,2,3]),[]);
 assert.deepEqual(remainingPartNumbers(1,[]),[1]);
 assert.throws(()=>remainingPartNumbers(26,[]),/INVALID_TOTAL/);
 assert.throws(()=>remainingPartNumbers(0,[]),/INVALID_TOTAL/);
});
test('only identical metadata and a nonempty sampled fingerprint can resume',()=>{
 const f='a'.repeat(64),other='b'.repeat(64);
 const sessions=[{id:'old',title:'iphone.mov',mime:'video/quicktime',size:15000000,fingerprint:''},
 {id:'new',title:'iphone.mov',mime:'video/quicktime',size:15000000,fingerprint:f,completedParts:[1]}];
 assert.equal(pickMatchingUpload(sessions,{title:'iphone.mov',mime:'video/quicktime',size:15000000,fingerprint:f})?.id,'new');
 assert.equal(pickMatchingUpload(sessions,{title:'iphone.mov',mime:'video/quicktime',size:15000000,fingerprint:other}),undefined);
 assert.equal(pickMatchingUpload(sessions,{title:'iphone.mov',mime:'video/quicktime',size:1,fingerprint:f}),undefined);
 assert.equal(pickMatchingUpload(sessions,{title:'other.mov',mime:'video/quicktime',size:15000000,fingerprint:f}),undefined);
 assert.equal(pickMatchingUpload(sessions,{title:'iphone.mov',mime:'video/quicktime',size:15000000,fingerprint:''}),undefined);
});
test('server endpoints preserve private access and original media',()=>{
 assert.match(worker,/app\.get\('\/api\/upload\/pending'/);
 assert.match(worker,/app\.get\('\/api\/media\/:id\/thumbnail'/);
 assert.match(worker,/app\.put\('\/api\/media\/:id\/thumbnail'/);
 assert.match(worker,/!await authenticated\(c\)/);
 assert.match(worker,/!sameOrigin\(c\)/);
 assert.match(worker,/image\/jpeg/);
 assert.match(worker,/THUMBNAIL_TOO_LARGE/);
 assert.match(worker,/R2|c\.env\.MEDIA\.put/);
 assert.match(worker,/await c\.env\.MEDIA\.delete\(\[row\.object_key,thumbKey\(id\)\]\)/);
 assert.match(worker,/app\.get\('\/api\/media\/:id\/content'/);
 assert.match(migration,/ALTER TABLE media_uploads ADD COLUMN fingerprint/);
});
test('frontend reselects files and does not automatically cancel recoverable sessions',()=>{
 assert.match(ui,/pickMatchingUpload\(queue/);
 assert.match(ui,/remainingPartNumbers\(total/);
 assert.match(ui,/重新选择同一文件/);
 assert.match(ui,/async function discard\(id:string\)/);
 assert.doesNotMatch(ui,/if\(uploadId\)await post\('\/api\/upload\/'\+uploadId\+'\/cancel'/);
 assert.match(ui,/createAlbumThumbnail\(file\)/);
 assert.match(ui,/\/thumbnail'/);
});
