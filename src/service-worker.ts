/// <reference lib="webworker" />
import {deviceRead,deviceList,deviceWrite,PRIVATE_MEDIA_CACHE} from './offline-store.mjs';
import {PRIVATE_THUMBNAIL_CACHE,MAX_AUTO_THUMBNAILS,cacheableThumbnail,thumbnailVersion} from './private-media-cache.mjs';
const sw=self as unknown as ServiceWorkerGlobalScope;
declare const __SHELL_ASSETS__:string[];
const SHELL_CACHE='__SHELL_CACHE__',SHELL_ASSETS=__SHELL_ASSETS__;
const downloads=new Map<string,{stream:ReadableStream<Uint8Array>;timer:ReturnType<typeof setTimeout>}>();
sw.addEventListener('install',event=>event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL_ASSETS)).then(()=>sw.skipWaiting())));
sw.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('babymemo-shell-')&&k!==SHELL_CACHE).map(k=>caches.delete(k)))).then(()=>sw.clients.claim())));
sw.addEventListener('message',event=>{if(event.data?.type==='LOCK')event.waitUntil((async()=>{await deviceWrite('resources',{id:'__session',value:{unlocked:false}});await Promise.all([caches.delete(PRIVATE_MEDIA_CACHE),caches.delete(PRIVATE_THUMBNAIL_CACHE)])})())});
sw.addEventListener('message',event=>{
 if(event.data?.type!=='EXPORT_DOWNLOAD'||!event.ports[0]||!event.source||!/^[-a-f0-9]{36}$/.test(event.data.token))return;
 const port=event.ports[0],token=event.data.token;let resolvePull:(()=>void)|null=null;
 const stream=new ReadableStream<Uint8Array>({start(controller){port.onmessage=message=>{if(message.data.done){controller.close();port.close()}else if(message.data.error){controller.error(Error('EXPORT_INTERRUPTED'));port.close()}else if(message.data.chunk)controller.enqueue(new Uint8Array(message.data.chunk));resolvePull?.();resolvePull=null}},pull(){return new Promise<void>(resolve=>{resolvePull=resolve;port.postMessage({type:'pull'})})},cancel(){port.postMessage({type:'cancel'});port.close()}});
 const timer=setTimeout(()=>{if(downloads.delete(token))void stream.cancel().catch(()=>{})},30000);
 downloads.set(token,{stream,timer});port.postMessage({type:'ready'});
});
async function rangeResponse(request:Request,response:Response):Promise<Response>{
 const range=request.headers.get('Range');if(!range)return response;
 const blob=await response.blob(),match=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!match)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+blob.size}});
 let start=match[1]?Number(match[1]):Math.max(0,blob.size-Number(match[2])),end=match[1]&&match[2]?Number(match[2]):blob.size-1;end=Math.min(end,blob.size-1);
 if(start>end||start>=blob.size)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+blob.size}});
 return new Response(blob.slice(start,end+1),{status:206,headers:{'Content-Type':response.headers.get('Content-Type')||blob.type,'Content-Length':String(end-start+1),'Content-Range':'bytes '+start+'-'+end+'/'+blob.size,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'}});
}
// Only versioned, server-confirmed JPEG derivatives enter this bounded cache.
// Originals are cached only by an explicit "offline save" action. A private
// session check gates every hit, including when the device has no connection.
async function storeThumbnail(request:Request,response:Response):Promise<void>{
 const session=await deviceRead('resources','__session');
 if(!session?.value.unlocked)return;
 const cache=await caches.open(PRIVATE_THUMBNAIL_CACHE),path=new URL(request.url).pathname;
 // A new revision supersedes the previous cover for the same media.
 for(const key of await cache.keys())if(new URL(key.url).pathname===path&&key.url!==request.url)await cache.delete(key);
 await cache.put(request,response);
 const keys=await cache.keys();
 for(const key of keys.slice(0,Math.max(0,keys.length-MAX_AUTO_THUMBNAILS)))await cache.delete(key);
}
async function thumbnailFallback(path:string):Promise<Response|undefined>{
 const cache=await caches.open(PRIVATE_THUMBNAIL_CACHE);
 const candidates=(await cache.keys()).filter(key=>new URL(key.url).pathname===path);
 return candidates.length?await cache.match(candidates[candidates.length-1]):undefined;
}
async function privateMedia(event:FetchEvent):Promise<Response>{
 const request=event.request,url=new URL(request.url),path=url.pathname;
 const deviceSession=await deviceRead('resources','__session');
 if(deviceSession?.value.unlocked===false)return new Response(null,{status:401});
 const version=thumbnailVersion(request.url);
 if(version&&deviceSession?.value.unlocked===true){
  const cached=await (await caches.open(PRIVATE_THUMBNAIL_CACHE)).match(request);
  if(cached)return cached;
 }
 try{
  // Always recheck credentials on a cache miss, and bypass legacy browser
  // HTTP entries that could return 304 for a private, previously viewed image.
  const response=await fetch(request,{cache:'no-store'});
  if(response.status===401){
   await deviceWrite('resources',{id:'__session',value:{unlocked:false}});
   await Promise.all([caches.delete(PRIVATE_MEDIA_CACHE),caches.delete(PRIVATE_THUMBNAIL_CACHE)]);
   return response;
  }
  if(deviceSession?.value.unlocked===true&&cacheableThumbnail(request.url,response))
   event.waitUntil(storeThumbnail(request,response.clone()).catch(()=>{}));
  return response;
 }catch{
  const session=await deviceRead('resources','__session');if(!session?.value.unlocked)return new Response(null,{status:401});
  if(path.endsWith('/thumbnail')){
   const last=await thumbnailFallback(path);
   if(last)return last;
  }
  // Explicit offline saves from previous versions must continue to work.
  const cache=await caches.open(PRIVATE_MEDIA_CACHE);let cached=await cache.match(path);
  if(!cached&&path.endsWith('/thumbnail'))cached=await cache.match(path.replace('/thumbnail','/content'));
  if(cached)return rangeResponse(request,cached);
  for(const job of await deviceList('jobs')){
   const media=path.match(/^\/api\/media\/([^/]+)\/(content|thumbnail)$/);
   if(job.file&&(job.kind==='media'&&job.id===media?.[1]||job.kind==='avatar'&&job.path===path)&&/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm))$/.test(job.payload.mime||''))return rangeResponse(request,new Response(job.file,{headers:{'Content-Type':job.payload.mime,'Content-Length':String(job.file.size),'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}}));
  }
  return new Response(null,{status:503});
 }
}
sw.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==sw.location.origin)return;
 const download=url.pathname.match(/^\/api\/export\/download\/([-a-f0-9]{36})$/);
 if(download&&downloads.has(download[1])){const {stream:body,timer}=downloads.get(download[1])!;clearTimeout(timer);downloads.delete(download[1]);event.respondWith(deviceRead('resources','__session').then(session=>{if(!session?.value.unlocked){void body.cancel();return new Response(null,{status:401})}return new Response(body,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="babymemo-family.zip"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}));return}
 if(/^\/api\/(?:media\/[^/]+\/(?:content|thumbnail)|babies\/[^/]+\/avatar)$/.test(url.pathname)){event.respondWith(privateMedia(event));return}
 if(url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>{const cache=await caches.open(SHELL_CACHE),shell=await cache.match('/index.html');if(!shell)return new Response('请联网打开一次 BabyMemo，再使用离线功能。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});return new Response(shell.body,{status:200,headers:shell.headers})}));return}
 if(SHELL_ASSETS.includes(url.pathname))event.respondWith(caches.open(SHELL_CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(request)));
});
