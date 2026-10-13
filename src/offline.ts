import {deviceRead,deviceList,deviceWrite,deviceRemove,deviceClear,projectMutation,PRIVATE_MEDIA_CACHE} from './offline-store.mjs';
import {ApiFailure,friendlyError} from './lib/errors';
export type OfflineJob={id:string;path:string;method:string;payload:Record<string,any>;createdAt:number;kind:'json'|'media'|'avatar';file?:Blob;error?:string};
const event=()=>{window.dispatchEvent(new Event('babymemo-offline'));const channel=new BroadcastChannel('babymemo-device');channel.postMessage('changed');channel.close()};
const unlocked=()=>localStorage.getItem('babymemo-unlocked')==='yes';
export const cachedPath=(path:string)=>/^\/api\/(?:state|records\/|growth\/history|media(?:\?|\/)|trash$|upload\/pending|babies\/archived\/list)/.test(path);
const writable=(path:string)=>/^\/api\/(?:records\/(?:growth|milestones)(?:\/[^/]+)?|babies(?:\/[^/]+(?:\/(?:restore|avatar))?)?|media\/[^/]+|trash\/(?:growth|milestones|media)\/[^/]+\/restore)$/.test(path);
export async function cacheResource(path:string,value:unknown){
 if(path==='/api/state'){localStorage.setItem('babymemo-unlocked','yes');await deviceWrite('resources',{id:'__session',value:{unlocked:true}})}
 let resource={id:path,value};for(const job of await offlineJobs())resource=projectMutation(resource,job);
 await deviceWrite('resources',resource);
 if(path.startsWith('/api/records/'))for(const row of (resource.value as {items?:any[]}).items||[])await deviceWrite('resources',{id:path.split('?')[0]+'/'+row.id,value:row});
 return resource.value;
}
export async function readCached(path:string){
 const session=await deviceRead('resources','__session');if(!unlocked()||!session?.value.unlocked)throw new ApiFailure(401,'LOGIN_REQUIRED');
 const resource=await deviceRead('resources',path);
 if(!resource)throw new ApiFailure(503,'OFFLINE_NOT_CACHED');
 return resource.value;
}
export async function clearDevice(){
 localStorage.removeItem('babymemo-unlocked');
 await deviceClear();await deviceWrite('resources',{id:'__session',value:{unlocked:false}});await caches.delete(PRIVATE_MEDIA_CACHE);
 for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key.startsWith('babymemo-draft-')||key.startsWith('bm-direct-'))storage.removeItem(key);
 navigator.serviceWorker?.controller?.postMessage({type:'LOCK'});event();
 const channel=new BroadcastChannel('babymemo-device');channel.postMessage('logout');channel.close();
}
export async function suspendDevice(){localStorage.removeItem('babymemo-unlocked');await deviceWrite('resources',{id:'__session',value:{unlocked:false}});navigator.serviceWorker?.controller?.postMessage({type:'LOCK'});event()}
export async function offlineJobs(){return (await deviceList<OfflineJob>('jobs')).sort((a,b)=>a.createdAt-b.createdAt)}
async function invalidateMedia(job:OfflineJob){
 const match=job.path.match(/^\/api\/media\/([^/]+)$/);
 const cache=await caches.open(PRIVATE_MEDIA_CACHE);
 if(job.method==='DELETE'&&match)await Promise.all([cache.delete('/api/media/'+match[1]+'/content'),cache.delete('/api/media/'+match[1]+'/thumbnail')]);
 if(job.path.endsWith('/avatar'))await cache.delete(job.path);
}
async function project(job:OfflineJob){for(const resource of await deviceList('resources'))await deviceWrite('resources',projectMutation(resource,job));await invalidateMedia(job);event()}
async function wire(path:string,init:RequestInit){
 const r=await fetch(path,{credentials:'same-origin',...init});let result:any={};try{result=await r.json()}catch{}
 if(!r.ok)throw new ApiFailure(r.status,typeof result.error==='string'?result.error:'HTTP_'+r.status);
 return result;
}
async function sendJob(job:OfflineJob){
 // Edits made after another queued edit depend on that acknowledged revision.
 if(String(job.payload.expectedUpdatedAt||'').startsWith('pending:')){
  const source=await deviceRead('resources','/__ack/'+job.payload.expectedUpdatedAt.slice('pending:'.length));
  if(typeof source?.value.updated_at!=='string')throw new ApiFailure(409,'EDIT_CONFLICT');
  job.payload.expectedUpdatedAt=source.value.updated_at;await deviceWrite('jobs',job);
 }
 if(job.kind==='avatar')return wire(job.path,{method:'PUT',headers:{'Content-Type':'image/jpeg','X-Avatar-Id':job.id,'X-Expected-Version':job.payload.expectedUpdatedAt??''},body:job.file});
 if(job.kind==='media'){
  const file=job.file!,p=job.payload,headers={'Content-Type':p.mime,'x-baby-id':p.babyId,'x-upload-day':p.day,'x-upload-title':encodeURIComponent(p.title),'x-upload-description':encodeURIComponent(p.description||'')};
  if(file.size<=5*1024*1024)return wire('/api/upload/direct/'+job.id,{method:'PUT',body:file,headers});
  const session=await wire('/api/upload/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p,size:file.size,requestId:job.id})});
  if(session.completed)return session;
  const pending=await wire('/api/upload/pending?babyId='+encodeURIComponent(p.babyId),{});
  const completed=new Set(pending.items.find((x:any)=>x.id===session.id)?.completedParts||[]);
  for(let part=1;part<=Math.ceil(file.size/8388608);part++)if(!completed.has(part))await wire('/api/upload/'+session.id+'/part/'+part,{method:'PUT',body:file.slice((part-1)*8388608,part*8388608),headers:{'Content-Type':'application/octet-stream'}});
  return wire('/api/upload/'+session.id+'/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 }
 return wire(job.path,{method:job.method,headers:{'Content-Type':'application/json','X-Request-Id':job.id},body:JSON.stringify(job.payload)});
}
let syncing:Promise<void>|null=null;
const completedReplies=new Map<string,Record<string,unknown>>();
export function syncOffline():Promise<void>{
 if(syncing)return syncing;
 const run=async()=>{
  if(!navigator.onLine||!unlocked())return;
  for(const job of await offlineJobs()){
   if(job.error)break;
   try{const reply=await sendJob(job);if(job.kind==='media'&&reply.updated_at===undefined)reply.updated_at='';await deviceWrite('resources',{id:'/__ack/'+job.id,value:reply});await invalidateMedia(job);completedReplies.set(job.id,reply);if(completedReplies.size>64)completedReplies.delete(completedReplies.keys().next().value!);await deviceRemove('jobs',job.id);event()}
   catch(e){if(e instanceof ApiFailure){if(e.status===401){await suspendDevice();break}if(e.status<500){job.error=friendlyError(e.message);await deviceWrite('jobs',job);event()}}break}
  }
 };
 const operation=async()=>{if(navigator.locks)await navigator.locks.request('babymemo-outbox',async()=>{await run()});else await run()};
 const promise=operation().finally(()=>{syncing=null});syncing=promise;return promise;
}
export async function writeOffline(path:string,init:RequestInit){
 if(!writable(path))return null;
 if(!unlocked())throw new ApiFailure(401,'LOGIN_REQUIRED');
 const payload=typeof init.body==='string'?JSON.parse(init.body):{},id=payload.requestId||crypto.randomUUID();
 if(init.method==='POST'&&(path==='/api/babies'||/^\/api\/records\/(growth|milestones)$/.test(path)))payload.requestId=id;
 const previous=await deviceRead<OfflineJob>('jobs',id);
 if(previous&&JSON.stringify(previous.payload)!==JSON.stringify(payload))throw new ApiFailure(409,'REQUEST_ID_CONFLICT');
 const job:OfflineJob=previous||{id,path,method:init.method||'POST',payload,createdAt:Date.now(),kind:'json'};
 try{await deviceWrite('jobs',job)}catch{throw new ApiFailure(507,'DEVICE_STORAGE_UNAVAILABLE')}
 await syncOffline();const pending=await deviceRead<OfflineJob>('jobs',id);
 if(pending?.error){await deviceRemove('jobs',id);event();throw new ApiFailure(409,pending.error)}
 if(pending)await project(job);
 const reply=completedReplies.get(id);completedReplies.delete(id);
 return {ok:true,id,...reply,queued:!!pending};
}
export async function queueMedia(file:Blob,payload:Record<string,any>,kind:'media'|'avatar'='media',path='',id:string=crypto.randomUUID()){
 if(!unlocked())throw new ApiFailure(401,'LOGIN_REQUIRED');
 const job:OfflineJob={id,path,method:'PUT',payload,createdAt:Date.now(),kind,file};
 try{await deviceWrite('jobs',job)}catch{throw new ApiFailure(507,'本机存储空间不足，文件尚未保存。请联网上传或腾出空间后重试。')}
 await project(job);event();return job.id;
}
export async function retryOffline(id:string){const job=await deviceRead<OfflineJob>('jobs',id);if(job){delete job.error;await deviceWrite('jobs',job)}await syncOffline();event()}
export async function discardOffline(id:string){await deviceRemove('jobs',id);await deviceClear(['resources']);event()}
export function startOffline(){
 const wake=()=>{void syncOffline().catch(()=>{})};window.addEventListener('online',wake);
 const channel=new BroadcastChannel('babymemo-device');channel.onmessage=e=>{if(e.data==='logout')window.location.reload();else window.dispatchEvent(new Event('babymemo-offline'))};
 void navigator.storage?.persist?.().catch(()=>{});
 if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js',{type:'module',updateViaCache:'none'}).catch(()=>{});
 wake();
}
export async function saveMediaOffline(path:string){
 if(!unlocked())throw new ApiFailure(401,'LOGIN_REQUIRED');
 const response=await fetch(path,{credentials:'same-origin'});if(!response.ok)throw new ApiFailure(response.status,'无法下载原件');
 await (await caches.open(PRIVATE_MEDIA_CACHE)).put(path,response);
}
