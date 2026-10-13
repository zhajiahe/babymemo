import {deviceRead,deviceList,deviceWrite,PRIVATE_MEDIA_CACHE} from '/offline-store.mjs';
const SHELL_CACHE='__SHELL_CACHE__',SHELL_ASSETS=__SHELL_ASSETS__;
const downloads=new Map();
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL_ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('babymemo-shell-')&&k!==SHELL_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='LOCK')event.waitUntil(deviceWrite('resources',{id:'__session',value:{unlocked:false}}).then(()=>caches.delete(PRIVATE_MEDIA_CACHE)))});
self.addEventListener('message',event=>{
 if(event.data?.type!=='EXPORT_DOWNLOAD'||!event.ports[0]||!event.source||!/^[-a-f0-9]{36}$/.test(event.data.token))return;
 const port=event.ports[0],token=event.data.token;let resolvePull;
 const stream=new ReadableStream({start(controller){port.onmessage=message=>{if(message.data.done){controller.close();port.close()}else if(message.data.error){controller.error(Error('EXPORT_INTERRUPTED'));port.close()}else if(message.data.chunk)controller.enqueue(new Uint8Array(message.data.chunk));resolvePull?.();resolvePull=null}},pull(){return new Promise(resolve=>{resolvePull=resolve;port.postMessage({type:'pull'})})},cancel(){port.postMessage({type:'cancel'});port.close()}});
 const timer=setTimeout(()=>{if(downloads.delete(token))void stream.cancel().catch(()=>{})},30000);
 downloads.set(token,{stream,timer});port.postMessage({type:'ready'});
});
async function rangeResponse(request,response){
 const range=request.headers.get('Range');if(!range)return response;
 const blob=await response.blob(),match=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!match)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+blob.size}});
 let start=match[1]?Number(match[1]):Math.max(0,blob.size-Number(match[2])),end=match[1]&&match[2]?Number(match[2]):blob.size-1;end=Math.min(end,blob.size-1);
 if(start>end||start>=blob.size)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+blob.size}});
 return new Response(blob.slice(start,end+1),{status:206,headers:{'Content-Type':response.headers.get('Content-Type')||blob.type,'Content-Length':String(end-start+1),'Content-Range':'bytes '+start+'-'+end+'/'+blob.size,'Accept-Ranges':'bytes','Cache-Control':'private, no-store'}});
}
async function privateMedia(event){
 const request=event.request,url=new URL(request.url),path=url.pathname;
 const deviceSession=await deviceRead('resources','__session');if(deviceSession?.value.unlocked===false)return new Response(null,{status:401});
 try{
  const response=await fetch(request);
  if(response.status===401){await deviceWrite('resources',{id:'__session',value:{unlocked:false}});await caches.delete(PRIVATE_MEDIA_CACHE)}
  if(response.status===200&&!url.searchParams.has('download')&&Number(response.headers.get('Content-Length')||Infinity)<=25*1024*1024){
   const copy=response.clone();event.waitUntil(deviceRead('resources','__session').then(async session=>{if(session?.value.unlocked)await (await caches.open(PRIVATE_MEDIA_CACHE)).put(path,copy)}).catch(()=>{}));
  }
  return response;
 }catch{
  const session=await deviceRead('resources','__session');if(!session?.value.unlocked)return new Response(null,{status:401});
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
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin)return;
 const download=url.pathname.match(/^\/api\/export\/download\/([-a-f0-9]{36})$/);
 if(download&&downloads.has(download[1])){const {stream:body,timer}=downloads.get(download[1]);clearTimeout(timer);downloads.delete(download[1]);event.respondWith(deviceRead('resources','__session').then(session=>{if(!session?.value.unlocked){void body.cancel();return new Response(null,{status:401})}return new Response(body,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="babymemo-family.zip"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}));return}
 if(/^\/api\/(?:media\/[^/]+\/(?:content|thumbnail)|babies\/[^/]+\/avatar)$/.test(url.pathname)){event.respondWith(privateMedia(event));return}
 if(url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>{const cache=await caches.open(SHELL_CACHE),shell=await cache.match('/index.html');if(!shell)return new Response('请联网打开一次 BabyMemo，再使用离线功能。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});return new Response(shell.body,{status:200,headers:shell.headers})}));return}
 if(SHELL_ASSETS.includes(url.pathname))event.respondWith(caches.open(SHELL_CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(request)));
});
