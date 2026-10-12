import assert from 'node:assert/strict';
import test from 'node:test';
import {cleanupExpiredUploads} from '../src/upload-cleanup.mjs';

function fixture({completed=false,failAbort=false,changed=false}={}){
 const row={id:'m1',baby_id:'b1',day:'2026-01-01',title:'photo.jpg',mime:'image/jpeg',size:7,
 object_key:'private/b1/m1',upload_id:'u1',created_at:'2026-01-01T00:00:00.000Z'};
 const state={deleted:false,aborted:0,saved:0};
 const env={
   DB:{prepare(sql){return {
     bind(...args){return {
       async all(){if(sql.startsWith('SELECT * FROM'))return {results:[row]};return {results:[{partNumber:1,etag:'etag'}]};},
       async first(){if(changed && sql.includes('COALESCE'))return null;return sql.includes('SELECT id FROM media')?null:{id:'m1'};},
       async run(){state.deleted=true}
     }}
   }},async batch(){state.saved++}},
   MEDIA:{
     async head(){return completed?{size:7}:null;},
     resumeMultipartUpload(){return {async abort(){state.aborted++;if(failAbort)throw Error('R2 offline')}}}
   }
 };
 return {env,state};
}
test('abandoned multipart is aborted and metadata deleted',async()=>{
 const {env,state}=fixture();
 const stats=await cleanupExpiredUploads({env,olderThan:'2026-09-01',finalizeUpload:async()=>({recovered:false})});
 assert.equal(stats.aborted,1);assert.equal(stats.errors,0);
 assert.equal(state.aborted,1);assert.equal(state.deleted,true);
});
test('full R2 object is recovered in D1 instead of aborted',async()=>{
 const {env,state}=fixture({completed:true});
 const stats=await cleanupExpiredUploads({env,olderThan:'2026-09-01',
 finalizeUpload:async({persist})=>{await persist();return {recovered:true}}});
 assert.equal(stats.recovered,1);assert.equal(state.saved,1);assert.equal(state.aborted,0);
});
test('R2 outage retains metadata for retry',async()=>{
 const {env,state}=fixture({failAbort:true});
 const stats=await cleanupExpiredUploads({env,olderThan:'2026-09-01',finalizeUpload:async()=>({recovered:false})});
 assert.equal(stats.errors,1);assert.equal(state.deleted,false);
});
test('recently changed activity protects upload from deletion',async()=>{
 const {env,state}=fixture({changed:true});
 const stats=await cleanupExpiredUploads({env,olderThan:'2026-09-01',finalizeUpload:async()=>({recovered:false})});
 assert.equal(stats.skipped,1);assert.equal(state.deleted,false);
});
