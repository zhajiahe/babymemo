// One-off, access-controlled R2-to-R2 migration. No private media leaves Cloudflare.
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const hex=v=>v?[...new Uint8Array(v)].map(b=>b.toString(16).padStart(2,'0')).join(''):null;
const sameMetadata=(a,b)=>a?.httpMetadata?.contentType===b?.httpMetadata?.contentType&&a?.httpMetadata?.cacheControl===b?.httpMetadata?.cacheControl&&JSON.stringify(a?.customMetadata||{})===JSON.stringify(b?.customMetadata||{});
function sameChecksum(a,b){
 for(const algorithm of ['sha256','sha1','md5']){
  const x=hex(a.checksums?.[algorithm]),y=hex(b.checksums?.[algorithm]);
  if(x&&y)return x===y;
 }
 return null;
}
async function progress(env){return env.STATE.prepare('SELECT cursor,completed,scanned,copied,bytes_copied,failures FROM apac_media_copy_progress WHERE id=1').first()}
async function copyNext(env){
 const state=await progress(env);
 if(!state)throw Error('STATE_MISSING');
 if(state.completed)return {completed:true,scanned:state.scanned,copied:state.copied,bytesCopied:state.bytes_copied};
 const page=await env.SOURCE.list({limit:10,include:['httpMetadata','customMetadata'],...(state.cursor?{cursor:state.cursor}:{})});
 let copied=0,bytes=0,skipped=0;
 try{
  // Sequential, streaming copying stays below Workers Free subrequest and memory limits.
  for(const item of page.objects){
   const exists=await env.TARGET.head(item.key);
   if(exists&&exists.size===item.size&&sameMetadata(item,exists)&&sameChecksum(item,exists)!==false){skipped++;continue}
   const original=await env.SOURCE.get(item.key);
   if(!original||original.size!==item.size)throw Error('SOURCE_CHANGED');
   const result=await env.TARGET.put(item.key,original.body,{httpMetadata:original.httpMetadata,customMetadata:original.customMetadata});
   if(!result||result.size!==item.size)throw Error('COPY_SIZE_MISMATCH');
   const verified=await env.TARGET.head(item.key);
   if(!verified||verified.size!==item.size||!sameMetadata(original,verified)||sameChecksum(original,verified)===false)throw Error('COPY_METADATA_OR_CHECKSUM_MISMATCH');
   copied++;bytes+=item.size;
  }
  await env.STATE.prepare('UPDATE apac_media_copy_progress SET cursor=?,completed=?,scanned=scanned+?,copied=copied+?,bytes_copied=bytes_copied+?,last_run=? WHERE id=1').bind(page.truncated?page.cursor:'',page.truncated?0:1,page.objects.length,copied,bytes,new Date().toISOString()).run();
  const next=await progress(env);
  return {completed:!!next.completed,scanned:next.scanned,copied:next.copied,skipped,bytesCopied:next.bytes_copied};
 }catch(e){
  await env.STATE.prepare('UPDATE apac_media_copy_progress SET failures=failures+1,last_run=? WHERE id=1').bind(new Date().toISOString()).run();
  throw e;
 }
}
async function sameRange(env,key,offset,length){
 const [a,b]=await Promise.all([env.SOURCE.get(key,{range:{offset,length}}),env.TARGET.get(key,{range:{offset,length}})]);
 if(!a||!b)return false;
 const [x,y]=await Promise.all([a.arrayBuffer(),b.arrayBuffer()]);
 const left=new Uint8Array(x),right=new Uint8Array(y);
 return left.length===right.length&&left.every((value,i)=>value===right[i]);
}
async function verifyNext(env,cursor){
 const page=await env.SOURCE.list({limit:8,include:['httpMetadata','customMetadata'],...(cursor?{cursor}:{})});
 let verified=0,mismatches=0,checksumVerified=0;
 for(const item of page.objects){
  const copy=await env.TARGET.head(item.key);
  if(!copy||copy.size!==item.size||!sameMetadata(item,copy)){mismatches++;continue}
  const digest=sameChecksum(item,copy);
  if(digest===false){mismatches++;continue}
  if(digest===true){checksumVerified++;verified++;continue}
  const sample=Math.min(8192,item.size);
  if(sample===0){verified++;continue}
  let equal=true;
  for(const offset of item.size<=sample?[0]:[0,item.size-sample])if(!await sameRange(env,item.key,offset,sample)){equal=false;break}
  if(equal)verified++;else mismatches++;
 }
 return {verified,mismatches,checksumVerified,complete:!page.truncated,cursor:page.truncated?page.cursor:null};
}
export default {
 async fetch(request,env){
  const expected=env.MIGRATION_TOKEN,actual=request.headers.get('Authorization');
  if(!expected||!actual||actual!=='Bearer '+expected)return respond({error:'not_found'},404);
  const url=new URL(request.url);
  try{
   if(request.method==='GET'&&url.pathname==='/status')return respond(await progress(env));
   if(request.method==='POST'&&url.pathname==='/copy')return respond(await copyNext(env));
   if(request.method==='GET'&&url.pathname==='/verify'){
    const cursor=url.searchParams.get('cursor')||'';
    if(cursor.length>1024)return respond({error:'invalid_cursor'},400);
    return respond(await verifyNext(env,cursor));
   }
  }catch(e){
   console.error(JSON.stringify({event:'APAC_SHADOW_COPY_FAILED',reason:e instanceof Error?e.message:'UNKNOWN'}));
   return respond({error:'copy_failed'},500);
  }
  return respond({error:'not_found'},404);
 }
};