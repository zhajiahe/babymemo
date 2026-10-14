import {RecordFilterBar,type RecordFilters} from '../../components/RecordFilters';
import {queueMedia} from '../../offline';
import {useEffect,useRef,useState} from 'react';
import {Card,Pager} from '../../components/ui';
import {MediaViewer,type MediaItem} from '../../components/MediaViewer';
import {createAlbumThumbnail,createVideoThumbnail,fingerprintFile} from '../../media-upload';
import {pickMatchingUpload,remainingPartNumbers} from '../../upload-plan.mjs';
import {mapBounded,transferConcurrency,canDirectUpload} from '../../media-transfer.mjs';
import {bestEffortFileDay} from '../../media-date.mjs';
import {CloudUpload,Camera,Trash2,Plus,Play} from 'lucide-react';
import {api,post,today,ApiFailure,type BabyInfo} from '../../lib/client';

export function Album({baby,media,mediaEdited,changed,notify,hasMore,page,setPage,filters,onFilters}:{baby:BabyInfo;media:MediaItem[];mediaEdited:(id:string,value:Partial<MediaItem>)=>void;changed:()=>void;notify:(v:string)=>void;hasMore:boolean;page:number;setPage:(v:number)=>void;filters:RecordFilters;onFilters:(value:RecordFilters)=>void}){
 const [uploading,setUploading]=useState(false),[progress,setProgress]=useState('');
 const [showUploader,setShowUploader]=useState(false);
 const thumbnailTail=useRef<Promise<void>>(Promise.resolve());
 const [uploadDay,setUploadDay]=useState(today(baby.time_zone)),[autoDate,setAutoDate]=useState(true);
 const [uploadDescription,setUploadDescription]=useState('');
 const [selected,setSelected]=useState<MediaItem|null>(null);
 useEffect(()=>{setSelected(null)},[baby.id]);
 type PendingUpload={id:string;day:string;title:string;description:string;mime:string;size:number;fingerprint:string;completedParts:number[];created_at:string};
 const [pending,setPending]=useState<PendingUpload[]>([]);
 async function refreshPending(){
  const response=await api<{items:PendingUpload[]}>('/api/upload/pending?babyId='+encodeURIComponent(baby.id));
  setPending(response.items);
  return response.items;
 }
 useEffect(()=>{
  let live=true;
  void api<{items:PendingUpload[]}>('/api/upload/pending?babyId='+encodeURIComponent(baby.id))
    .then(response=>{if(live)setPending(response.items)})
    .catch(()=>{if(live)setPending([])});
  return()=>{live=false};
 },[baby.id]);
 async function finishPending(id:string){
  if(uploading)return;
  setUploading(true);
  try{
   await post('/api/upload/'+id+'/finish',{});
   await refreshPending();
   changed();
   notify('上传已完成，照片或视频已保存。');
  }catch(e){notify(e instanceof Error?e.message:'保存失败，可稍后重试')}
  finally{setUploading(false)}
 }
 async function discard(id:string){
  if(uploading||!confirm('确定取消这项未完成的上传吗？已上传的分片会被删除。'))return;
  try{
   await post('/api/upload/'+id+'/cancel',{});
   await refreshPending();
   notify('已取消未完成上传');
  }catch(e){notify(e instanceof Error?e.message:'取消失败')}
 }
 async function upload(files:File[]){
  if(!files.length||uploading)return;
  setUploading(true);
  const description=uploadDescription.trim();
  const mobile=window.matchMedia('(pointer:coarse)').matches;
  const policy=transferConcurrency(mobile,files.length);
  let saved=0,failedFiles=0;
  const report=(stage:'client'|'thumbnail',size:number,startedAt:number,status:'ok'|'error')=>{
   void post('/api/upload/metrics',{stage,size,durationMs:Math.round(performance.now()-startedAt),status}).catch(()=>{});
  };
  try{
   const queue=navigator.onLine?await refreshPending():[];
   const reserved=new Set<string>();
   // Derivatives are best effort and never hold an original-file transfer slot.
   // Serialize decoding across batches to avoid exhausting iPhone Safari memory.
   const queueThumbnail=(file:File,mime:string,id:string)=>{
    if(!mime.startsWith('image/')&&!mime.startsWith('video/'))return;
    thumbnailTail.current=thumbnailTail.current.catch(()=>{}).then(async()=>{
     const previewStarted=performance.now();
     try{
      const thumb=mime.startsWith('image/')?await createAlbumThumbnail(file):await createVideoThumbnail(file);
      if(thumb){
       await api('/api/media/'+id+'/thumbnail',{method:'PUT',body:thumb,headers:{'Content-Type':'image/jpeg'}});
       changed();
      }
      report('thumbnail',file.size,previewStarted,'ok');
     }catch{report('thumbnail',file.size,previewStarted,'error');notify('原文件已保存，但预览图暂不可用（仍可查看原文件）')}
    });
   };
   const results=await mapBounded(files,policy.files,async file=>{
    const fileStarted=performance.now();
    let uploadId:string|undefined;
    let completedId='';
    let resumable:{babyId:string;day:string;title:string;description:string;mime:string;fingerprint:string}|null=null;
    try{
     if(file.size<1||file.size>209715200)throw Error('文件大小需在 1B～200MB 之间');
     const extension=file.name.toLowerCase().match(/\.(heic|heif|jpg|jpeg|png|webp|gif|mov|mp4|webm)$/)?.[1];
     const formats:Record<string,string>={heic:'image/heic',heif:'image/heif',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mov:'video/quicktime',mp4:'video/mp4',webm:'video/webm'};
     const mime=file.type||(extension?formats[extension]:'application/octet-stream');
     if(!/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm))$/.test(mime))throw Error('暂不支持此文件格式，请选择照片或 MP4、MOV、WebM 视频');
     const fingerprint=await fingerprintFile(file);
     const day=autoDate?await bestEffortFileDay(file,uploadDay,baby.time_zone):uploadDay;
     const title=file.name.slice(0,120);
     resumable={babyId:baby.id,day,title,description,mime,fingerprint};
     if(!navigator.onLine){await queueMedia(file,resumable);notify('已将 '+file.name+' 保存到本机，联网后自动上传');return}
     const matching=queue.find(item=>!reserved.has(item.id)&&pickMatchingUpload([item],{title,size:file.size,mime,fingerprint}));
     if(matching)reserved.add(matching.id);
     // A direct upload ID is preserved in sessionStorage until confirmation.
     // A lost HTTP response or Safari reload can be safely retried.
     if(!matching&&canDirectUpload(file.size)){
      const key='bm-direct-'+baby.id+'-'+fingerprint;
      let id='';
      try{id=localStorage.getItem(key)||''}catch{/* Safari private storage may be unavailable. */}
      if(!/^[0-9a-f-]{36}$/.test(id)){
       id=crypto.randomUUID();
       try{localStorage.setItem(key,id)}catch{/* Keep this attempt's ID in memory. */}
      }
      uploadId=id;
      const headers={'Content-Type':mime,'x-baby-id':baby.id,'x-upload-day':day,'x-upload-title':encodeURIComponent(title),'x-upload-description':encodeURIComponent(description)};
      for(let attempt=0;attempt<3;attempt++){
       try{
        await api('/api/upload/direct/'+id,{method:'PUT',body:file,headers});
        try{localStorage.removeItem(key)}catch{/* Storage is best effort. */}
        completedId=id;
        uploadId=undefined;
        break;
       }catch(error){
        if(attempt===2||error instanceof ApiFailure&&[400,401,403,409,413,415].includes(error.status))throw error;
        await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
       }
      }
     }else{
      const session=matching||await post<{id:string;chunkSize:number}>('/api/upload/start',{
       babyId:baby.id,day,title:file.name,description,mime,size:file.size,fingerprint
      });
      uploadId=session.id;
      const chunkSize=8388608,total=Math.ceil(file.size/chunkSize);
      const numbers=remainingPartNumbers(total,matching?.completedParts||[]);
      let finished=total-numbers.length,next=0,failed=false;
      if(matching)notify('正在续传：'+file.name);
      const sendPart=async(number:number)=>{
       const part=file.slice((number-1)*chunkSize,Math.min(file.size,number*chunkSize));
       for(let attempt=0;attempt<3;attempt++){
        try{
         await api('/api/upload/'+session.id+'/part/'+number,{method:'PUT',body:part,headers:{'Content-Type':'application/octet-stream'}});
         return;
        }catch(error){
         if(attempt===2||error instanceof ApiFailure&&[400,401,403,404,413].includes(error.status))throw error;
         await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
        }
       }
      };
      const workers=Array.from({length:Math.min(policy.parts,numbers.length)},async()=>{
       while(!failed&&next<numbers.length){
        const number=numbers[next++];
        try{
         await sendPart(number);finished++;
         setProgress('已保存 '+saved+'/'+files.length+' · '+file.name+' '+Math.round(finished/total*100)+'%');
        }catch(error){failed=true;throw error}
       }
      });
      const jobs=await Promise.allSettled(workers);
      const failedJob=jobs.find((x):x is PromiseRejectedResult=>x.status==='rejected');
      if(failedJob)throw failedJob.reason;
      for(let attempt=0;attempt<3;attempt++){
       try{await post('/api/upload/'+session.id+'/finish',{});break}
       catch(error){
        if(attempt===2||error instanceof ApiFailure&&[400,401,403,404,409].includes(error.status))throw error;
        await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
       }
      }
      completedId=session.id;
      uploadId=undefined;
     }
     saved++;
     const seconds=Math.max(0.001,(performance.now()-fileStarted)/1000);
     setProgress('已保存 '+saved+'/'+files.length+' · '+(file.size/1048576/seconds).toFixed(1)+' MiB/s');
     changed();
     notify('已保存 '+file.name);
     queueThumbnail(file,mime,completedId);
     report('client',file.size,fileStarted,'ok');
    }catch(error){
     if(resumable&&(!navigator.onLine||error instanceof TypeError)){
      try{await queueMedia(file,resumable,'media','',uploadId);notify(file.name+' 已保存在本机，联网后继续上传');return}catch{/* Fall through with an explicit storage/network failure. */}
     }
     failedFiles++;
     report('client',file.size,fileStarted,'error');
     notify(file.name+'：'+(error instanceof Error?error.message:'上传中断')+(uploadId&&!canDirectUpload(file.size)?'。重新选择同一文件即可续传。':''));
    }
   });
   if(failedFiles||results.some(x=>x.status==='rejected'))notify('有 '+(failedFiles+results.filter(x=>x.status==='rejected').length)+' 个文件未完成，可重新选择文件重试');
   if(navigator.onLine)await refreshPending();
   changed();
  }catch(error){
   notify(error instanceof Error?error.message:'无法检查未完成上传，请检查网络后重试');
  }finally{setUploading(false);setProgress('')}
 }
 async function remove(id:string){if(!confirm('将这项媒体移入回收站？30 天内可恢复。'))return;try{await api('/api/media/'+id,{method:'DELETE',body:JSON.stringify({babyId:baby.id})});if(selected?.id===id)setSelected(null);changed();notify('已移入回收站，可在设置中恢复')}catch(e){notify(e instanceof Error?e.message:'删除失败')}}
 async function saveMedia(value:{day:string;description:string;requestId?:string;expectedUpdatedAt?:string}){
  if(!selected)throw Error('请先选择照片或视频');
  const result=await api<{id:string;queued?:boolean;updated_at?:string}>('/api/media/'+selected.id,{method:'PATCH',body:JSON.stringify({...value,babyId:baby.id,expectedUpdatedAt:value.expectedUpdatedAt??selected.updated_at??''})});
  setSelected(current=>current?.id===selected.id?{...current,...value,updated_at:result.queued?'pending:'+result.id:result.updated_at,pending:result.queued}:current);
  // The list must update even when the media count stays unchanged.
  mediaEdited(selected.id,{...value,updated_at:result.queued?'pending:'+result.id:result.updated_at,pending:result.queued});
  changed();notify(result.queued?'照片修改已保存在本机，联网后同步':'照片信息已更新');return result;
 }
 function navigateMedia(step:number){
  if(!selected)return;
  const current=media.findIndex(item=>item.id===selected.id);
  const next=media[current+step];
  if(next)setSelected(next);
 }
 return <>
 <RecordFilterBar value={filters} onChange={onFilters} media/>
 <div className="album-toolbar album-content-toolbar">
  <div className="album-toolbar-heading"><h2>照片与视频</h2></div>
  <div className="album-toolbar-actions">
   <button type="button" className="primary album-add-btn" aria-expanded={showUploader} aria-controls="album-upload-panel" onClick={()=>setShowUploader(v=>!v)}><Plus size={17}/>{showUploader?'收起上传':'添加照片或视频'}</button></div>
 </div>
 {showUploader&&<Card className="upload-card"><div id="album-upload-panel" className="album-upload-panel"><CloudUpload size={30}/><h3>上传照片或视频</h3><p className="muted">可一次选择多张照片或视频。网络中断后重新选择原文件即可续传。</p>
  <div className="album-upload-options"><label><input type="checkbox" checked={autoDate} onChange={e=>setAutoDate(e.target.checked)}/> 优先使用拍摄日期</label><label>默认日期 <input type="date" value={uploadDay} max={today(baby.time_zone)} onChange={e=>setUploadDay(e.target.value)}/></label></div>
  <p className="muted small">照片自带拍摄日期时会按原日期归档；缺少日期时使用默认日期。关闭自动日期即可手动指定。</p>
  <label className="field album-upload-description"><span>描述（可选，本次选择的照片或视频共用）</span><textarea rows={2} maxLength={1000} value={uploadDescription} onChange={e=>setUploadDescription(e.target.value)} placeholder="例如：第一次去海边，笑得特别开心" /></label>
  <label className="upload-action">{uploading?'正在上传…':'选择照片或视频'}<input type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm,.mov" disabled={uploading} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void upload(files);}}/></label>
  {progress&&<p className="small" role="status">{progress}</p>}</div></Card>}
 {media.length?Array.from(new Set(media.map(item=>item.day.slice(0,7)))).map(month=>
  <section className="photo-month" key={month}><h3>{month.replace('-', ' 年 ')} 月</h3><div className="photo-grid">{media.filter(item=>item.day.startsWith(month)).map(item=>
   <div key={item.id} className="photo-item"><button type="button" className="photo-preview" onClick={()=>setSelected(item)} aria-label={'预览 '+item.day+' 的'+(item.mime.startsWith('video/')?'视频':'照片')}>
    <span className="photo-frame">{item.mime.startsWith('image/')||item.thumbnail_ready?<img src={'/api/media/'+item.id+'/thumbnail'} loading="lazy" decoding="async" alt=""/>:<span className="video-placeholder" aria-hidden="true"><Camera size={26}/><span>视频</span></span>}{item.mime.startsWith('video/')&&<span className="video-play-badge" aria-hidden="true"><Play size={18} fill="currentColor"/></span>}</span>
    <span className="photo-preview-hint">{item.mime.startsWith('image/')?'查看照片':'播放视频'}</span></button>
    {item.description&&<p className="photo-description" title={item.description}>{item.description}</p>}
   </div>)}</div></section>
 ):<div className="empty card"><p>还没有照片，上传第一张成长回忆吧。</p><button type="button" className="primary" onClick={()=>setShowUploader(true)}><Plus size={16}/> 添加照片或视频</button></div>}
 <Pager page={page} setPage={setPage} hasMore={hasMore}/>
 {pending.length>0&&<Card className="pending-uploads"><div className="section-title"><h3>待续传文件</h3><span className="muted small">{pending.length} 项</span></div><p className="muted small">中断后重新选择原文件，可以继续上传已经保存的分片。</p>
  {pending.map(item=><div className="pending-upload" key={item.id}><div><strong>{item.title||'未命名文件'}</strong><p className="muted small">已完成 {item.completedParts.length}/{Math.ceil(item.size/8388608)} 个分片 · {Math.ceil(item.size/1048576)} MB</p></div><div className="pending-actions">{item.completedParts.length===Math.ceil(item.size/8388608)&&<button className="primary" type="button" disabled={uploading} onClick={()=>void finishPending(item.id)}>完成保存</button>}<button className="secondary" type="button" disabled={uploading} onClick={()=>void discard(item.id)}>取消上传</button></div></div>)}
 </Card>}
 {selected&&<MediaViewer key={baby.id} item={selected} index={media.findIndex(item=>item.id===selected.id)} count={media.length} onNavigate={navigateMedia} onClose={()=>setSelected(null)} onSave={saveMedia} onDelete={()=>{if(selected)void remove(selected.id)}}/>}
 </>;
}
