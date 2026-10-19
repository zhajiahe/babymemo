import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './apac-copy-worker.mjs';

function harness(){
 const objects=new Map([
  ['private/test/photo.jpg',{data:Uint8Array.from({length:135},(_,i)=>i%251),mime:'image/jpeg'}],
  ['private/test/clip.mp4',{data:Uint8Array.from({length:18000},(_,i)=>(i*7)%251),mime:'video/mp4'}]
 ]);
 const dst=new Map(),sent=[],logs=[],cursorOrder=[...objects.keys()];
 const states={
  apac_media_copy_progress:{id:1,cursor:'',completed:0,scanned:0,copied:0,bytes_copied:0,failures:0},
  apac_copy_verification:{id:1,cursor:'',completed:0,verified:0,bytes_verified:0,failed:0}
 };
 function metadata(key){return {contentType:objects.get(key).mime,cacheControl:'private, no-store'}}
 function listing({cursor}){
  const offset=cursor?Number(cursor):0,keys=cursorOrder.slice(offset,offset+1),truncated=offset+1<cursorOrder.length;
  return {objects:keys.map(key=>({key,size:objects.get(key).data.length,httpMetadata:metadata(key),customMetadata:{}})),truncated,cursor:truncated?String(offset+1):undefined};
 }
 const wrap=(key,raw,opts={})=>{
  const range=opts.range?raw.slice(opts.range.offset,opts.range.offset+opts.range.length):raw;
  return {key,size:raw.length,httpMetadata:metadata(key),customMetadata:{},body:new Response(range).body,
   arrayBuffer:async()=>range.buffer.slice(range.byteOffset,range.byteOffset+range.byteLength)};
 };
 const env={
  SOURCE:{list:async opts=>listing(opts),get:async(k,opts)=>objects.has(k)?wrap(k,objects.get(k).data,opts):null},
  TARGET:{
   head:async key=>dst.has(key)?{size:dst.get(key).data.length,httpMetadata:dst.get(key).meta,customMetadata:{}}:null,
   get:async(key,opts)=>dst.has(key)?wrap(key,dst.get(key).data,opts):null,
   put:async(key,body,options)=>{
    const data=new Uint8Array(await new Response(body).arrayBuffer());
    dst.set(key,{data,meta:options.httpMetadata});
    return {size:data.length};
   }
  },
  STATE:{prepare(sql){
   const name=sql.includes('apac_media_copy_progress')?'apac_media_copy_progress':'apac_copy_verification';
   return {
    first:async()=>({...states[name]}),
    bind(...args){return {run:async()=>{
     const s=states[name];
     if(sql.includes('SET cursor=')){
      s.cursor=args[0];s.completed=args[1];
      if(name==='apac_media_copy_progress'){s.scanned+=args[2];s.copied+=args[3];s.bytes_copied+=args[4]}
      else {s.verified+=args[2];s.bytes_verified+=args[3]}
     }else if(sql.includes('failures=failures+1'))s.failures++;
     else if(sql.includes('failed=failed+1'))s.failed++;
    }}}
   };
  }},
  PIPE:{send:async value=>sent.push(value)}
 };
 async function drain(start={task:'copy'}){
  sent.push(start);
  let completed=0,retried=0;
  while(sent.length&&completed<20){
   const body=sent.shift(),message={body,ack(){completed++},retry(){retried++}};
   await worker.queue({messages:[message]},env);
   if(retried)break;
  }
  return {completed,retried};
 }
 return {dst,env,states,drain,sent,objects};
}
test('APAC queue worker has no public HTTP handler',()=>{
 assert.equal(typeof worker.fetch,'undefined');
 assert.equal(typeof worker.queue,'function');
});
test('copy is idempotent, streams raw bytes and verifies the full object set',async()=>{
 const t=harness();
 const run=await t.drain();
 assert.equal(run.retried,0);
 assert.equal(t.states.apac_media_copy_progress.completed,1);
 assert.equal(t.states.apac_media_copy_progress.scanned,2);
 assert.equal(t.states.apac_media_copy_progress.copied,2);
 assert.equal(t.states.apac_copy_verification.completed,1);
 assert.equal(t.states.apac_copy_verification.verified,2);
 for(const [key,value] of t.objects)
  assert.deepEqual(t.dst.get(key).data,value.data);
 const before=t.dst.size;
 await t.drain({task:'copy'});
 assert.equal(t.dst.size,before);
 assert.equal(t.states.apac_media_copy_progress.copied,2);
});
test('verification refuses altered byte ranges without advancing the checkpoint',async()=>{
 const t=harness();
 await t.drain();
 t.dst.get('private/test/photo.jpg').data[0]^=255;
 t.states.apac_copy_verification.completed=0;
 t.states.apac_copy_verification.cursor='';
 const result=await t.drain({task:'verify'});
 assert.equal(result.retried,1);
 assert.equal(t.states.apac_copy_verification.failed,1);
 assert.equal(t.states.apac_copy_verification.verified,2);
});
