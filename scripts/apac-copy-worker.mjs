/**
 * One-off APAC shadow sync using Cloudflare Queues (Free: no extra Cron triggers).
 * No HTTP listener, no public media routes, and no change to production bindings.
 * Source bucket is only read. A failed page is retried without advancing its cursor.
 */
const hex=b=>b?[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""):null;
const sameMetadata=(a,b)=>a?.httpMetadata?.contentType===b?.httpMetadata?.contentType &&
 a?.httpMetadata?.cacheControl===b?.httpMetadata?.cacheControl &&
 JSON.stringify(a?.customMetadata||{})===JSON.stringify(b?.customMetadata||{});
function sameDigest(a,b) {
 for(const kind of ["sha256","sha1","md5"]){
  const one=hex(a?.checksums?.[kind]),two=hex(b?.checksums?.[kind]);
  if(one&&two)return one===two;
 }
 return null; // Not equivalent to a full-file checksum.
}
const state=async(env,table)=>env.STATE.prepare("SELECT * FROM "+table+" WHERE id=1").first();
async function copyNext(env){
 const s=await state(env,"apac_media_copy_progress");
 if(!s||s.completed)return;
 const batch=await env.SOURCE.list({limit:8,include:["httpMetadata","customMetadata"],...(s.cursor?{cursor:s.cursor}:{})});
 let copied=0,bytes=0;
 for(const item of batch.objects){
  const existing=await env.TARGET.head(item.key);
  if(existing&&existing.size===item.size&&sameMetadata(item,existing)&&sameDigest(item,existing)!==false)continue;
  const source=await env.SOURCE.get(item.key);
  if(!source||source.size!==item.size)throw Error("SOURCE_UNAVAILABLE_OR_CHANGED");
  const uploaded=await env.TARGET.put(item.key,source.body,{
   httpMetadata:source.httpMetadata,customMetadata:source.customMetadata
  });
  if(!uploaded||uploaded.size!==item.size)throw Error("COPY_SIZE_MISMATCH");
  const checked=await env.TARGET.head(item.key);
  if(!checked||checked.size!==item.size||!sameMetadata(source,checked)||sameDigest(source,checked)===false)
   throw Error("COPY_METADATA_MISMATCH");
  copied++;bytes+=item.size;
 }
 await env.STATE.prepare(
  "UPDATE apac_media_copy_progress SET cursor=?,completed=?,scanned=scanned+?,copied=copied+?,bytes_copied=bytes_copied+?,last_run=? WHERE id=1"
 ).bind(batch.truncated?batch.cursor:"",batch.truncated?0:1,batch.objects.length,copied,bytes,new Date().toISOString()).run();
 console.log(JSON.stringify({event:"APAC_COPY_PAGE",count:batch.objects.length,copied,done:!batch.truncated}));
 await env.PIPE.send({task:batch.truncated?"copy":"verify"});
}
async function rangesAgree(env,item){
 const length=Math.min(8192,item.size);
 if(!length)return true;
 for(const offset of item.size>length?[0,item.size-length]:[0]){
  const [one,two]=await Promise.all([
   env.SOURCE.get(item.key,{range:{offset,length}}),env.TARGET.get(item.key,{range:{offset,length}})
  ]);
  if(!one||!two)return false;
  const [a,b]=await Promise.all([one.arrayBuffer(),two.arrayBuffer()]);
  const left=new Uint8Array(a),right=new Uint8Array(b);
  if(left.length!==right.length||left.some((v,i)=>v!==right[i]))return false;
 }
 return true;
}
async function verifyNext(env){
 const s=await state(env,"apac_copy_verification");
 if(!s||s.completed)return;
 const batch=await env.SOURCE.list({limit:7,include:["httpMetadata","customMetadata"],...(s.cursor?{cursor:s.cursor}:{})});
 let count=0,bytes=0;
 for(const item of batch.objects){
  const other=await env.TARGET.head(item.key);
  if(!other||other.size!==item.size||!sameMetadata(item,other))throw Error("VERIFY_METADATA_MISMATCH");
  const checksum=sameDigest(item,other);
  if(checksum===false||(checksum===null&&!await rangesAgree(env,item)))throw Error("VERIFY_BYTES_MISMATCH");
  count++;bytes+=item.size;
 }
 await env.STATE.prepare(
  "UPDATE apac_copy_verification SET cursor=?,completed=?,verified=verified+?,bytes_verified=bytes_verified+?,last_run=? WHERE id=1"
 ).bind(batch.truncated?batch.cursor:"",batch.truncated?0:1,count,bytes,new Date().toISOString()).run();
 console.log(JSON.stringify({event:"APAC_VERIFY_PAGE",count,done:!batch.truncated}));
 if(batch.truncated)await env.PIPE.send({task:"verify"});
}
export default {
 async queue(batch,env){
  for(const message of batch.messages){
   const task=message.body?.task;
   if(task!=="copy"&&task!=="verify"){message.ack();continue}
   try{
    if(task==="copy")await copyNext(env);else await verifyNext(env);
    message.ack();
   }catch(err){
    const table=task==="copy"?"apac_media_copy_progress":"apac_copy_verification";
    const field=task==="copy"?"failures":"failed";
    await env.STATE.prepare("UPDATE "+table+" SET "+field+"="+field+"+1,last_run=? WHERE id=1").bind(new Date().toISOString()).run();
    console.error(JSON.stringify({event:"APAC_COPY_ERROR",stage:task,reason:err instanceof Error?err.message:"UNKNOWN"}));
    message.retry({delaySeconds:30});
   }
  }
 }
};
