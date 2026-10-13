// One durable consumer per WeChat connection, using the existing BOT namespace.
// Payloads/results are encrypted by the caller. Status never contains payloads.
export const MAX_MEDIA_TASKS=32;
const RETRY_MS=30000;
const key=id=>'media-job:'+id;
const stamp=()=>new Date().toISOString();
export async function mediaTaskId(sourceId){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceId));
 return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export class DurableMediaQueue {
 constructor(storage,hooks){this.storage=storage;this.hooks=hooks;this.running=false}
 async enqueue(sourceId,payload){
  const id=await mediaTaskId(sourceId);
  return this.storage.transaction(async tx=>{
   const done=await tx.get('media-done')||[];
   if(done.includes(id))return {accepted:true,alreadyDone:true};
   const ids=await tx.get('media-order')||[];
   if(ids.includes(id)){await tx.setAlarm(Date.now()+1);return {accepted:true}}
   if(ids.length>=MAX_MEDIA_TASKS)return {accepted:false};
   const generation=await tx.get('media-generation')||crypto.randomUUID();
   await tx.put('media-generation',generation);
   await tx.put(key(id),{payload,generation,phase:'pending',attempts:0,nextAt:0,createdAt:stamp()});
   await tx.put('media-order',[...ids,id]);
   await tx.setAlarm(Date.now()+1);
   return {accepted:true};
  });
 }
 async status(){
  const ids=await this.storage.get('media-order')||[];
  const jobs=await Promise.all(ids.map(id=>this.storage.get(key(id))));
  return {pending:jobs.filter(Boolean).length,
   saving:jobs.some(j=>j?.phase==='saving'),
   notifying:jobs.some(j=>j?.phase==='reply'),
   retrying:jobs.some(j=>j?.nextAt>Date.now()),
   lastError:await this.storage.get('media-last-error')||null,
   lastCompleted:await this.storage.get('media-last-completed')||null};
 }
 async start(){if((await this.storage.get('media-order')||[]).length)await this.storage.setAlarm(Date.now()+1)}
 async pause(){await this.storage.deleteAlarm()}
 async reset(){
  await this.storage.transaction(async tx=>{
   const ids=await tx.get('media-order')||[];
   for(const id of ids)await tx.delete(key(id));
   await tx.put('media-generation',crypto.randomUUID());
   await tx.put('media-order',[]);
   await tx.delete('media-done');await tx.delete('media-last-error');await tx.delete('media-last-completed');
   await tx.deleteAlarm();
  });
 }
 async owns(id,job){
  const current=await this.storage.get(key(id));
  return !!current&&current.generation===job.generation&&await this.storage.get('media-generation')===job.generation;
 }
 async save(id,job){
  return this.storage.transaction(async tx=>{
   const current=await tx.get(key(id));
   if(!current||current.generation!==job.generation||await tx.get('media-generation')!==job.generation)return false;
   await tx.put(key(id),job);return true;
  });
 }
 async finish(id,job){
  await this.storage.transaction(async tx=>{
   const current=await tx.get(key(id));
   if(!current||current.generation!==job.generation)return;
   await tx.put('media-order',(await tx.get('media-order')||[]).filter(x=>x!==id));
   await tx.put('media-done',[...(await tx.get('media-done')||[]),id].slice(-64));
   await tx.delete(key(id));
  });
 }
 async alarm(){
  if(this.running)return;
  this.running=true;
  try{
   const id=(await this.storage.get('media-order')||[])[0];if(!id)return;
   let job=await this.storage.get(key(id));if(!job)return;
   let permission=await this.hooks.permission(job.payload);
   if(permission==='paused')return;
   if(permission!=='active'){await this.finish(id,job);return}
   if(job.nextAt>Date.now())return;
   if(job.phase!=='reply'){
    job={...job,phase:'saving',attempts:job.attempts+1,nextAt:0};
    if(!await this.save(id,job))return;
    let result;
    try{result=await this.hooks.execute(job.payload)}
    catch(error){
     if(!await this.owns(id,job))return;
     const code=this.hooks.errorCode(error);
     await this.storage.put('media-last-error',{code,attempt:job.attempts,at:stamp()});
     result=await this.hooks.failure(job.payload,error,job.attempts);
     if(!result){await this.save(id,{...job,phase:'pending',nextAt:Date.now()+RETRY_MS});return}
    }
    if(!await this.owns(id,job))return;
    job={...job,phase:'reply',result:result.payload,ok:result.ok,nextAt:0};
    if(!await this.save(id,job))return;
   }
   permission=await this.hooks.permission(job.payload);
   if(permission==='paused')return;
   if(permission!=='active'){await this.finish(id,job);return}
   try{await this.hooks.deliver(job.payload,job.result,'media-'+id.slice(0,40))}
   catch(error){
    if(await this.owns(id,job)){
     await this.storage.put('media-last-error',{code:this.hooks.errorCode(error),attempt:job.attempts,at:stamp()});
     await this.save(id,{...job,nextAt:Date.now()+RETRY_MS});
    }
    return;
   }
   if(!await this.owns(id,job))return;
   if(job.ok){await this.storage.delete('media-last-error');await this.storage.put('media-last-completed',stamp())}
   await this.finish(id,job);
  }finally{
   this.running=false;
   const id=(await this.storage.get('media-order')||[])[0];
   const job=id?await this.storage.get(key(id)):null;
   if(job&&await this.hooks.permission(job.payload)==='active')await this.storage.setAlarm(Math.max(Date.now()+1,job.nextAt||0));
  }
 }
}
