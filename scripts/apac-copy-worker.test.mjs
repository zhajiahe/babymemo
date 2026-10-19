import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './apac-copy-worker.mjs';
function fixture(){
 const raw=Uint8Array.from([1,2,3,4,5,6,7,8,9]),metadata={contentType:'image/jpeg',cacheControl:'private, max-age=0'};
 const object={key:'private/synthetic.jpg',size:raw.length,httpMetadata:metadata,customMetadata:{}};
 const dest=new Map(),state={cursor:'',completed:0,scanned:0,copied:0,bytes_copied:0,failures:0};
 const get=(data,opts)=>{
  const offset=opts?.range?.offset??0,length=opts?.range?.length??data.length,range=data.slice(offset,offset+length);
  return {size:data.length,httpMetadata:metadata,customMetadata:{},body:new Response(range).body,arrayBuffer:async()=>range.buffer.slice(range.byteOffset,range.byteOffset+range.byteLength)};
 };
 const env={MIGRATION_TOKEN:'test-only-secret-1234567890123456789012345',
  STATE:{prepare(sql){return {first:async()=>({...state}),bind(...args){return {run:async()=>{if(sql.includes('failures=failures+1')){state.failures++;return} [state.cursor,state.completed]=args;state.scanned+=args[2];state.copied+=args[3];state.bytes_copied+=args[4];}}}}}},
  SOURCE:{list:async()=>({objects:[object],truncated:false}),get:async(k,opts)=>get(raw,opts)},
  TARGET:{head:async key=>dest.get(key)?.meta||null,get:async(key,opts)=>dest.has(key)?get(dest.get(key).data,opts):null,
   put:async(key,stream,opts)=>{const data=new Uint8Array(await new Response(stream).arrayBuffer());const meta={size:data.length,httpMetadata:opts.httpMetadata,customMetadata:opts.customMetadata};dest.set(key,{meta,data});return meta;}}
 };
 const call=async(path,method='GET',auth=true)=>{const r=await worker.fetch(new Request('https://local.test'+path,{method,headers:auth?{Authorization:'Bearer '+env.MIGRATION_TOKEN}:{}}),env);return {status:r.status,value:await r.json()};};
 return {call,dest,state};
}
test('APAC copy is authenticated, idempotent and checks bytes',async()=>{
 const f=fixture();
 assert.equal((await f.call('/copy','POST',false)).status,404);
 assert.equal(f.dest.size,0);
 const copied=await f.call('/copy','POST');
 assert.equal(copied.status,200);assert.equal(copied.value.completed,true);assert.equal(copied.value.copied,1);
 const checked=await f.call('/verify');
 assert.equal(checked.value.mismatches,0);assert.equal(checked.value.verified,1);
 await f.call('/copy','POST');assert.equal(f.state.copied,1);
 f.dest.get('private/synthetic.jpg').data[0]=99;
 assert.equal((await f.call('/verify')).value.mismatches,1);
});
