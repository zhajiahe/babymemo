import test from 'node:test';
import assert from 'node:assert/strict';
import {mapBounded,transferConcurrency,canDirectUpload,DIRECT_UPLOAD_LIMIT} from '../src/media-transfer.mjs';
import {mediaTiming,mediaSizeBand} from '../src/media-timing.mjs';

test('small originals use direct path; larger originals preserve resumable multipart',()=>{
 assert.equal(canDirectUpload(DIRECT_UPLOAD_LIMIT),true);
 assert.equal(canDirectUpload(DIRECT_UPLOAD_LIMIT+1),false);
 assert.equal(canDirectUpload(0),false);
 assert.deepEqual(transferConcurrency(true,8),{files:2,parts:1});
 assert.deepEqual(transferConcurrency(false,8),{files:2,parts:2});
 assert.deepEqual(transferConcurrency(true,1),{files:1,parts:2});
});
test('concurrent upload queue is bounded, overlaps files, and preserves input order',async()=>{
 let active=0,peak=0;
 const values=await mapBounded([30,20,5,15,1],2,async(t,i)=>{
  active++;peak=Math.max(peak,active);
  await new Promise(r=>setTimeout(r,t));active--;
  return i;
 });
 assert.deepEqual(values.map(x=>x.value),[0,1,2,3,4]);
 assert.equal(peak,2);
});
test('one upload error does not prevent independent files from finishing',async()=>{
 let called=0;
 const r=await mapBounded([1,2,3],2,async x=>{called++;if(x===2)throw Error('temporary');return x*2});
 assert.equal(called,3);assert.equal(r[1].status,'rejected');
 assert.deepEqual([r[0].value,r[2].value],[2,6]);
});
test('media timing is bounded, PII-free and size bucketed',()=>{
 const messages=[],rec=mediaTiming({channel:'wechat',stage:'r2',size:9*1024*1024,startedAt:100,
  now:()=>315.4,emit:message=>messages.push(message)});
 assert.equal(rec.durationMs,215);
 assert.equal(rec.sizeBand,'8-50MiB');
 assert.deepEqual(Object.keys(rec).sort(),['channel','durationMs','event','level','sizeBand','stage','status'].sort());
 assert.equal(messages.length,1);
 assert.ok(!messages[0].includes('filename'));
 assert.equal(mediaSizeBand(DIRECT_UPLOAD_LIMIT),'1-5MiB');
 const bad=mediaTiming({channel:'https://example/?key=secret',stage:'filename.png',size:-1,startedAt:-999999999,now:()=>10000000000,emit:()=>{}});
 assert.equal(bad.channel,'unknown');assert.equal(bad.stage,'unknown');assert.equal(bad.durationMs,600000);
});
