import {api} from './lib/client';
import {createRemoteVideoThumbnail} from './media-upload';

/**
 * A Worker cannot decode H.264/HEVC/MOV frames. When WeChat provides no JPEG
 * thumb_media, use the signed-in browser's native video decoder and HTTP Range
 * endpoint. The original never leaves private R2 or gets transcoded.
 *
 * Runs only in a visible, online tab; each original is attempted once per tab
 * session. A bounded foreground pass avoids battery/network spikes on iPhone.
 */
const attempted=new Set<string>();
let running=false;
type Candidate={id:string;mime:string;size:number};
export async function repairMissingVideoCovers(babyIds:string[],signal:AbortSignal):Promise<void>{
 if(running||signal.aborted||!navigator.onLine||document.visibilityState!=='visible')return;
 running=true;
 let count=0;
 try{
  for(const babyId of [...new Set(babyIds)]){
   if(signal.aborted||!navigator.onLine||document.visibilityState!=='visible')break;
   let after='';
   // Cursor is stable by ID. Skip candidates already attempted in this tab.
   for(let pages=0;pages<50;pages++){
    if(signal.aborted||!navigator.onLine||document.visibilityState!=='visible'||count>=12)break;
    const batch=await api<{items:Candidate[]}>('/api/media/thumbnail-backfill?type=video&babyId='+encodeURIComponent(babyId)+'&after='+encodeURIComponent(after));
    if(!batch.items.length)break;
    for(const item of batch.items){
     after=item.id;
     if(attempted.has(item.id))continue;
     if(signal.aborted||!navigator.onLine||document.visibilityState!=='visible'||count>=12)break;
     attempted.add(item.id);count++;
     try{
      const jpeg=await createRemoteVideoThumbnail(item.id);
      if(!jpeg||signal.aborted)continue;
      const saved=await api<{updated_at?:string}>('/api/media/'+encodeURIComponent(item.id)+'/thumbnail',{
       method:'PUT',headers:{'Content-Type':'image/jpeg'},body:jpeg,signal
      });
      if(!signal.aborted)window.dispatchEvent(new CustomEvent('babymemo:thumbnail-repaired',{
       detail:{id:item.id,updatedAt:saved.updated_at}
      }));
     }catch{/* Unsupported codec, network or document suspension: keep the original. */}
    }
    if(batch.items.length<10)break;
   }
  }
 }catch{/* A temporary scan failure must never affect login or album browsing. */}
 finally{running=false}
}
