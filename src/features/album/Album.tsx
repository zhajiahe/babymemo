import {useEffect,useRef,useState} from 'react';
import {Card,Pager} from '../../components/ui';
import {MediaViewer,type MediaItem} from '../../components/MediaViewer';
import {createAlbumThumbnail,createStoredThumbnail,createVideoThumbnail,fingerprintFile} from '../../media-upload';
import {pickMatchingUpload,remainingPartNumbers} from '../../upload-plan.mjs';
import {bestEffortFileDay} from '../../media-date.mjs';
import {CloudUpload,Camera,Heart,Trash2} from 'lucide-react';
import {api,post,today,ApiFailure,type BabyInfo} from '../../lib/client';

export function Album({baby,media,query,onQuery,favoriteOnly,onFavoriteOnly,favoriteUpdated,mediaEdited,changed,notify,hasMore,page,setPage}:{baby:BabyInfo;media:MediaItem[];query:string;onQuery:(v:string)=>void;favoriteOnly:boolean;onFavoriteOnly:(v:boolean)=>void;favoriteUpdated:(id:string,favorite:boolean)=>void;mediaEdited:(id:string,value:{title:string;day:string})=>void;changed:()=>void;notify:(v:string)=>void;hasMore:boolean;page:number;setPage:(v:number)=>void}){
 const [uploading,setUploading]=useState(false),[progress,setProgress]=useState('');
 const [uploadDay,setUploadDay]=useState(today()),[autoDate,setAutoDate]=useState(true);
 const [selected,setSelected]=useState<MediaItem|null>(null);
 useEffect(()=>{setSelected(null)},[baby.id]);
 type PendingUpload={id:string;day:string;title:string;mime:string;size:number;fingerprint:string;completedParts:number[];created_at:string};
 const [pending,setPending]=useState<PendingUpload[]>([]);
 const [backfill,setBackfill]=useState({remaining:0,running:false,completed:0,skipped:0,failed:0});
 const stopBackfill=useRef(false);
 async function refreshBackfill(){
  const response=await api<{items:{id:string;mime:string;size:number}[];remaining:number;cursor:string}>(
   '/api/media/thumbnail-backfill?babyId='+encodeURIComponent(baby.id));
  setBackfill(old=>({...old,remaining:response.remaining}));
  return response;
 }
 useEffect(()=>{
  stopBackfill.current=false;
  setBackfill({remaining:0,running:false,completed:0,skipped:0,failed:0});
  void refreshBackfill().catch(()=>{});
  return()=>{stopBackfill.current=true};
 },[baby.id]);
 async function backfillThumbnails(){
  if(backfill.running||uploading)return;
  stopBackfill.current=false;
  setBackfill(old=>({...old,running:true,completed:0,skipped:0,failed:0}));
  let cursor='',completed=0,skipped=0,failed=0;
  try{
   while(!stopBackfill.current){
    const result=await api<{items:{id:string;mime:string;size:number}[];remaining:number;cursor:string}>(
     '/api/media/thumbnail-backfill?babyId='+encodeURIComponent(baby.id)+'&after='+encodeURIComponent(cursor));
    if(!result.items.length)break;
    for(const item of result.items){
     if(stopBackfill.current)break;
     try{
      if(item.size>25*1024*1024){skipped++;continue;}
      const thumb=await createStoredThumbnail(item.id,item.mime);
      if(!thumb){skipped++;continue;}
      await api('/api/media/'+item.id+'/thumbnail',{
       method:'PUT',body:thumb,headers:{'Content-Type':'image/jpeg'}
      });
      completed++;
     }catch{failed++}
     finally{setBackfill(old=>({...old,completed,skipped,failed}))}
    }
    cursor=result.cursor;
   }
   const summary=await refreshBackfill();
   notify('缩略图补全：成功 '+completed+' 张，跳过 '+skipped+' 张，失败 '+failed+' 张。剩余 '+summary.remaining+' 张可稍后重试。');
  }catch(e){notify(e instanceof Error?e.message:'补全中断，可重新操作')}
  finally{setBackfill(old=>({...old,running:false,completed,skipped,failed}))}
 }

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
  try{
   let queue=await refreshPending();
   for(const file of files){
    let uploadId:string|undefined;
    try{
     if(file.size<1||file.size>209715200)throw Error('文件大小需在 1B～200MB 之间');
     const extension=file.name.toLowerCase().match(/\.(heic|heif|jpg|jpeg|png|webp|gif|mov|mp4|webm)$/)?.[1];
     const formats:Record<string,string>={heic:'image/heic',heif:'image/heif',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',mov:'video/quicktime',mp4:'video/mp4',webm:'video/webm'};
     const mime=file.type||(extension?formats[extension]:'application/octet-stream');
     setProgress(file.name+' · 正在检查分片');
     const fingerprint=await fingerprintFile(file);
     const existing=pickMatchingUpload(queue,{title:file.name.slice(0,120),size:file.size,mime,fingerprint}) as PendingUpload|undefined;
     const session=existing||await post<{id:string;chunkSize:number}>('/api/upload/start',{babyId:baby.id,day:autoDate?await bestEffortFileDay(file,uploadDay):uploadDay,title:file.name,mime,size:file.size,fingerprint});
     uploadId=session.id;
     const chunkSize=8388608;
     const total=Math.ceil(file.size/chunkSize);
     const numbers=remainingPartNumbers(total,existing?.completedParts||[]);
     const completed=new Set(existing?.completedParts||[]);
     if(existing)notify('找到上次的上传，正在续传：'+file.name);
     let next=0,failed=false;
     const sendPart=async(number:number)=>{
      const part=file.slice((number-1)*chunkSize,Math.min(file.size,number*chunkSize));
      for(let attempt=0;attempt<3;attempt++){
       try{
        await api('/api/upload/'+uploadId+'/part/'+number,{method:'PUT',body:part,headers:{'Content-Type':'application/octet-stream'}});
        return;
       }catch(error){
        if(attempt===2||error instanceof ApiFailure&&[400,401,403,404,413].includes(error.status))throw error;
        await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
       }
      }
     };
     const concurrency=window.matchMedia('(pointer:coarse)').matches?2:3;
     const jobs=Array.from({length:Math.min(concurrency,numbers.length)},async()=>{
      while(!failed&&next<numbers.length){
       const number=numbers[next++];
       try{
        await sendPart(number);
        completed.add(number);
        setProgress(file.name+' · '+Math.round(completed.size/total*100)+'%');
       }catch(error){failed=true;throw error}
      }
     });
     const results=await Promise.allSettled(jobs);
     const rejection=results.find((x):x is PromiseRejectedResult=>x.status==='rejected');
     if(rejection)throw rejection.reason;
     setProgress(file.name+' · 正在保存原文件');
     for(let attempt=0;attempt<3;attempt++){
      try{await post('/api/upload/'+uploadId+'/finish',{});break;}
      catch(error){
       if(attempt===2||error instanceof ApiFailure&&[400,401,403,404,409].includes(error.status))throw error;
       await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
      }
     }
     uploadId=undefined;
     queue=queue.filter(x=>x.id!==session.id);
     changed();
     notify('已保存 '+file.name);
     // Thumbnails are independent of the original multipart upload.
     if(mime.startsWith('image/')||mime.startsWith('video/')){
      try{
       setProgress(file.name+' · 正在生成预览图');
       const thumb=mime.startsWith('image/')?await createAlbumThumbnail(file):await createVideoThumbnail(file);
       if(thumb)await api('/api/media/'+session.id+'/thumbnail',{method:'PUT',body:thumb,headers:{'Content-Type':'image/jpeg'}});
      }catch{
       notify(file.name+' 已保存，但预览图暂不可用（仍可查看原文件）');
      }
     }
    }catch(error){
     // Never abort a recoverable session automatically; Safari can lose connectivity.
     notify(file.name+'：'+(error instanceof Error?error.message:'上传中断')+(uploadId?'。重新选择同一文件即可续传。':''));
    }
    try{queue=await refreshPending()}catch{}
   }
  }catch(error){
   notify(error instanceof Error?error.message:'无法检查未完成上传，请检查网络后重试');
  }finally{
   setUploading(false);
   setProgress('');
  }
 }
 async function remove(id:string){if(!confirm('将这项媒体移入回收站？30 天内可恢复。'))return;try{await api('/api/media/'+id,{method:'DELETE'});if(selected?.id===id)setSelected(null);changed();notify('已移入回收站，可在设置中恢复')}catch(e){notify(e instanceof Error?e.message:'删除失败')}}
 async function toggleFavorite(item:MediaItem){try{const favorite=!item.favorite;await post('/api/media/'+item.id+'/favorite',{favorite});favoriteUpdated(item.id,favorite);notify(favorite?'已收藏':'已取消收藏')}catch(e){notify(e instanceof Error?e.message:'收藏失败')}}
 async function saveMedia(value:{title:string;day:string}){
  if(!selected)return;
  await api('/api/media/'+selected.id,{method:'PATCH',body:JSON.stringify(value)});
  setSelected(current=>current?.id===selected.id?{...current,...value}:current);
  // The list must update even when the media count stays unchanged.
  mediaEdited(selected.id,value);
  changed();notify('照片信息已更新');
 }
 function navigateMedia(step:number){
  if(!selected)return;
  const current=media.findIndex(item=>item.id===selected.id);
  const next=media[current+step];
  if(next)setSelected(next);
 }
 return <><Card className="upload-card"><CloudUpload size={34}/><h3>收藏镜头里的成长</h3><p className="muted">支持照片、MP4 与 iPhone MOV，按 8MB 分片上传，大文件也无需一次传完。</p><div className="album-upload-options"><label><input type="checkbox" checked={autoDate} onChange={e=>setAutoDate(e.target.checked)}/> 优先使用 JPEG 拍摄日期；其他文件回退修改日期（可手动改）</label><label>默认日期 <input type="date" value={uploadDay} max={today()} onChange={e=>setUploadDay(e.target.value)}/></label></div><label className="upload-action">{uploading?'正在上传…':'选择照片或视频'}<input type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm,.mov" disabled={uploading} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';void upload(files);}}/></label>{progress&&<p className="small" role="status">{progress}</p>}</Card>
 {backfill.remaining>0&&<Card className="thumbnail-backfill"><div className="section-title"><h3>补全旧照片缩略图</h3><span className="muted small">{backfill.remaining} 张待处理</span></div><p className="muted small">需要通过当前设备下载旧照片并生成私有缩略图。建议连接 Wi-Fi，保持页面开启。原图不会被修改；不支持解码或大于 25MB 的照片会跳过。</p><div className="backfill-actions">{backfill.running?<button className="secondary" type="button" onClick={()=>{stopBackfill.current=true}}>停止补全</button>:<button className="primary" type="button" disabled={uploading} onClick={()=>void backfillThumbnails()}>开始补全</button>}<span className="muted small">{backfill.running?'处理中 · ':''}成功 {backfill.completed} · 跳过 {backfill.skipped} · 失败 {backfill.failed}</span></div></Card>}
 {pending.length>0&&<Card className="pending-uploads"><div className="section-title"><h3>待续传文件</h3><span className="muted small">{pending.length} 项</span></div><p className="muted small">网络中断或刷新页面后，重新选择原来的文件，会自动识别并继续上传未完成的分片。文件不会保存在本网站中。</p>{pending.map(item=><div className="pending-upload" key={item.id}><div><strong>{item.title||'未命名文件'}</strong><p className="muted small">已完成 {item.completedParts.length}/{Math.ceil(item.size/8388608)} 个分片 · {Math.ceil(item.size/1048576)} MB</p></div><div className="pending-actions">{item.completedParts.length===Math.ceil(item.size/8388608)&&<button className="primary" type="button" disabled={uploading} onClick={()=>void finishPending(item.id)}>完成保存</button>}<button className="secondary" type="button" disabled={uploading} onClick={()=>void discard(item.id)}>取消上传</button></div></div>)}</Card>}
 <div className="album-toolbar"><label className="field">搜索名称<input type="search" value={query} maxLength={80} placeholder="查找照片或视频" onChange={e=>onQuery(e.target.value)}/></label><label className="album-favorite-filter"><input type="checkbox" checked={favoriteOnly} onChange={e=>onFavoriteOnly(e.target.checked)}/> <Heart size={15}/> 仅看收藏</label></div>
 {Array.from(new Set(media.map(item=>item.day.slice(0,7)))).map(month=><section className="photo-month" key={month}><h3>{month.replace('-', ' 年 ')} 月</h3><div className="photo-grid">{media.filter(item=>item.day.startsWith(month)).map(item=><Card key={item.id} className="photo-item"><button type="button" className="photo-preview" onClick={()=>setSelected(item)} aria-label={'预览 '+(item.title||'成长回忆')}><span className="photo-frame">{item.mime.startsWith('image/')||item.thumbnail_ready?<img src={'/api/media/'+item.id+'/thumbnail'} loading="lazy" decoding="async" alt="" />:<span className="video-placeholder" aria-hidden="true"><Camera size={32}/><span>视频 · 点击播放</span></span>}</span><span className="photo-preview-hint">{item.mime.startsWith('image/')?'查看照片':'播放视频'}</span></button><div className="photo-caption"><div><strong>{item.title||'未命名'}</strong><p>{item.day}</p></div><div className="photo-actions"><button type="button" className={'icon-btn '+(item.favorite?'is-favorite':'')} onClick={()=>void toggleFavorite(item)} aria-label={item.favorite?'取消收藏':'收藏'}><Heart size={16} fill={item.favorite?'currentColor':'none'}/></button><button type="button" className="icon-btn" onClick={()=>void remove(item.id)} aria-label={'删除 '+(item.title||'媒体')}><Trash2 size={16}/></button></div></div></Card>)}</div></section>)}{!media.length&&<div className="empty card">还没有照片，试试上传第一张。</div>}<Pager page={page} setPage={setPage} hasMore={hasMore}/>{selected&&<MediaViewer key={baby.id} item={selected} index={media.findIndex(item=>item.id===selected.id)} count={media.length} onNavigate={navigateMedia} onClose={()=>setSelected(null)} onSave={saveMedia}/> }</>;
}
