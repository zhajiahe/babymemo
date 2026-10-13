import {streamZip,textEntry,type ZipEntry} from './stream-zip.mjs';
import {offlineJobs,syncOffline} from './offline';
export async function downloadFamilyArchive(){
 const abort=new AbortController();
 await syncOffline();if((await offlineJobs()).length)throw Error('请先同步待保存的内容，再导出完整家庭档案。');
 const response=await fetch('/api/export/manifest',{credentials:'same-origin'});if(!response.ok)throw Error('无法准备家庭档案，请检查登录和网络。');
 const manifest=await response.json() as {snapshot:unknown;files:{id:string;kind:string;path:string;size?:number}[]};
 if(!navigator.serviceWorker?.controller){window.location.assign('/api/export/full');return}
 const entries:ZipEntry[]=[textEntry('records.json',JSON.stringify(manifest.snapshot,null,2)),textEntry('manifest.json',JSON.stringify({schema:'babymemo-family-browser-archive-v1',files:manifest.files},null,2)),textEntry('README.txt','BabyMemo family archive\nrecords.json includes baby profiles, birth times, growth, milestones, media metadata and milestone-media links. media/ contains unmodified originals; avatars/ and thumbnails/ contain portraits and existing derivatives.\nZIP64 CRC32 validates archive bytes. Login hashes and API/WeChat credentials are excluded. Keep this archive private. Avoid changing/deleting media during download. An interrupted archive must be downloaded again.\n')];
 for(const file of manifest.files){
  const entry:ZipEntry={name:file.path,size:file.size,open:async()=>{
   const original=await fetch('/api/export/file?kind='+encodeURIComponent(file.kind)+'&id='+encodeURIComponent(file.id),{credentials:'same-origin',signal:abort.signal});
   const size=Number(original.headers.get('Content-Length'));
   if(!original.ok||!original.body||!Number.isSafeInteger(size)||size<0||file.size!==undefined&&file.size!==size)throw Error('原件缺失或发生变化，导出已中断。');
   entry.size=size;return original.body;
  }};entries.push(entry);
 }
 const reader=streamZip(entries).getReader(),channel=new MessageChannel(),token=crypto.randomUUID();
 const frame=document.createElement('iframe');frame.hidden=true;frame.title='家庭档案下载';
 await new Promise<void>((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>;
  const fail=(error:Error)=>{clearTimeout(timer);abort.abort();channel.port1.postMessage({error:true});channel.port1.close();void reader.cancel().catch(()=>{});reject(error)};
  const watch=(ms:number)=>{clearTimeout(timer);timer=setTimeout(()=>fail(Error('下载通道中断，请保持页面打开并重新导出。')),ms)};
  watch(15000);
  channel.port1.onmessage=event=>{
   if(event.data.type==='ready'){
    watch(120000);frame.src='/api/export/download/'+token;document.body.appendChild(frame);
   }else if(event.data.type==='pull'){
    watch(120000);
    void reader.read().then(result=>{
     if(result.done){clearTimeout(timer);channel.port1.postMessage({done:true});channel.port1.close();resolve()}
     else{const chunk=result.value.slice().buffer;channel.port1.postMessage({chunk},[chunk])}
 }).catch(fail);
   }else if(event.data.type==='cancel')fail(Error('导出已取消。'));
  };
  navigator.serviceWorker.controller!.postMessage({type:'EXPORT_DOWNLOAD',token},[channel.port2]);
 }).finally(()=>{setTimeout(()=>frame.remove(),1000)});
}
