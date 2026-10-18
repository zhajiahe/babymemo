import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileStaleWechatMedia} from '../src/wechat-media-reconcile.mjs';

function fixture({object=null,cover=false,headFails=false,race=false}={}){
 const record={
  id:'media-one',baby_id:'baby-one',object_key:'private/baby-one/media-one',
  mime:'image/jpeg',title:'爸爸拍的照片',day:'2026-10-10',
  description:'被被真可爱',size:0,thumbnail_ready:0,upload_state:'processing'
 };
 const calls=[];
 const DB={prepare(sql){
  const q={args:[],bind(...args){this.args=args;return this},
   async all(){return {results:record.upload_state==='processing'?[record]:[]}},
   async run(){
    calls.push(sql);
    if(race)record.upload_state='ready';
    if(record.upload_state!=='processing')return {meta:{changes:0}};
    if(sql.includes("SET mime=?")){
     [record.mime,record.size,record.thumbnail_ready]=this.args.slice(0,3);
     record.upload_state='ready';
    }else if(sql.includes("SET upload_state='failed'"))record.upload_state='failed';
    return {meta:{changes:1}};
   }};
  return q;
 }};
 const MEDIA={async head(key){
  if(headFails)throw Error('R2 temporarily unavailable');
  if(key.startsWith('private/thumbnails/'))return cover?{size:123}:null;
  return object;
 }};
 return {record,calls,env:{DB,MEDIA}};
}
const cutoff='2026-10-18T00:00:00.000Z';
test('complete and verified R2 original recovers a stale WeChat reservation without losing edited metadata',async()=>{
 const x=fixture({object:{size:2048,httpMetadata:{contentType:'image/heic'}},cover:true});
 const result=await reconcileStaleWechatMedia(x.env,cutoff);
 assert.deepEqual(result,{scanned:1,recovered:1,failed:0,skipped:0,errors:0});
 assert.equal(x.record.upload_state,'ready');
 assert.equal(x.record.mime,'image/heic');
 assert.equal(x.record.size,2048);
 assert.equal(x.record.thumbnail_ready,1);
 assert.equal(x.record.description,'被被真可爱');
 assert.equal(x.record.day,'2026-10-10');
 assert.equal(x.record.title,'爸爸拍的照片');
 assert.equal(x.calls.length,1);
});
test('missing original becomes visible failure, never falsely ready or delete original',async()=>{
 const x=fixture();
 const result=await reconcileStaleWechatMedia(x.env,cutoff);
 assert.equal(result.failed,1);
 assert.equal(x.record.upload_state,'failed');
 assert.equal(x.record.size,0);
 assert.equal(x.calls.some(s=>/DELETE/i.test(s)),false);
});
test('wrong MIME in R2 cannot masquerade as a valid photo',async()=>{
 const x=fixture({object:{size:350,httpMetadata:{contentType:'text/html'}}});
 const result=await reconcileStaleWechatMedia(x.env,cutoff);
 assert.equal(result.failed,1);assert.equal(x.record.upload_state,'failed');
});
test('outage keeps the pending row for safe future retry',async()=>{
 const x=fixture({headFails:true});
 const result=await reconcileStaleWechatMedia(x.env,cutoff);
 assert.equal(result.errors,1);assert.equal(x.record.upload_state,'processing');
 assert.equal(x.calls.length,0);
});
test('concurrent queue completion wins optimistic reconciliation',async()=>{
 const x=fixture({race:true,object:{size:350,httpMetadata:{contentType:'image/jpeg'}}});
 const result=await reconcileStaleWechatMedia(x.env,cutoff);
 assert.equal(result.skipped,1);assert.equal(result.recovered,0);
});
