/**
 * Opt-in, foreground-document background runner for private thumbnails.
 * Video decoding needs the browser's media engine: no Worker/Cron claim is made.
 * A checkpoint is saved after every item and resumed after a signed-in reload.
 */
import {api} from './lib/client';
import {createStoredThumbnail,createRemoteVideoThumbnail} from './media-upload';

export type RepairPhase='idle'|'running'|'paused'|'completed';
export type RepairSnapshot={
 phase:RepairPhase;
 babyIds:string[];
 babyIndex:number;
 after:string;
 total:number;
 processed:number;
 repaired:number;
 failed:number;
 error:string;
};
type Candidate={id:string;mime:string;size:number};
type Batch={items:Candidate[];remaining:number;cursor:string};
const key='babymemo-thumbnail-repair-v1';
const leaseKey='babymemo-thumbnail-repair-lease-v1';
const tabId=crypto.randomUUID();
const listeners=new Set<()=>void>();
const empty=():RepairSnapshot=>({phase:'idle',babyIds:[],babyIndex:0,after:'',total:0,processed:0,repaired:0,failed:0,error:''});
function load():RepairSnapshot{
 try{
  const value=JSON.parse(localStorage.getItem(key)||'null') as Partial<RepairSnapshot>|null;
  if(!value||!Array.isArray(value.babyIds)||!['running','paused','completed'].includes(value.phase||'')
    ||!Number.isSafeInteger(value.babyIndex)||!Number.isSafeInteger(value.processed)||!Number.isSafeInteger(value.total)
    ||typeof value.after!=='string')return empty();
  return {...empty(),...value,babyIds:value.babyIds.filter((id):id is string=>typeof id==='string'&&id.length<128)};
 }catch{return empty()}
}
let snapshot=load();
let currentRun=0;
let running=false;
const emit=()=>{for(const fn of listeners)fn()};
function update(value:RepairSnapshot){
 snapshot=value;
 try{localStorage.setItem(key,JSON.stringify(snapshot))}catch{/* Task can still run in memory. */}
 emit();
}
export const getThumbnailRepairSnapshot=()=>snapshot;
export const subscribeThumbnailRepair=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}};
function sameBabies(ids:string[]){return ids.length===snapshot.babyIds.length&&ids.every((id,i)=>snapshot.babyIds[i]===id)}
function lease(){
 try{
  const prev=JSON.parse(localStorage.getItem(leaseKey)||'null') as {owner?:string;until?:number}|null;
  if(prev&&prev.owner!==tabId&&Number(prev.until)>Date.now())return false;
  localStorage.setItem(leaseKey,JSON.stringify({owner:tabId,until:Date.now()+60000}));
  return true;
 }catch{return true}
}
function releaseLease(){
 try{const existing=JSON.parse(localStorage.getItem(leaseKey)||'null');if(existing?.owner===tabId)localStorage.removeItem(leaseKey)}catch{}
}
function active(token:number){return token===currentRun&&snapshot.phase==='running'}
async function visible(){
 if(document.visibilityState==='visible')return;
 await new Promise<void>(resolve=>{
  const wake=()=>{if(document.visibilityState!=='visible')return;document.removeEventListener('visibilitychange',wake);resolve()};
  document.addEventListener('visibilitychange',wake);
 });
}
async function batch(babyId:string,after:string):Promise<Batch>{
 const url='/api/media/thumbnail-backfill?type=all&babyId='+encodeURIComponent(babyId)+'&after='+encodeURIComponent(after);
 return api<Batch>(url);
}
async function repair(item:Candidate){
 const blob=item.mime.startsWith('video/')
  ?await createRemoteVideoThumbnail(item.id)
  :await createStoredThumbnail(item.id,item.mime);
 if(!blob)throw Error('THUMBNAIL_UNSUPPORTED');
 await api('/api/media/'+encodeURIComponent(item.id)+'/thumbnail',{
  method:'PUT',headers:{'Content-Type':'image/jpeg'},body:blob
 });
}
async function execute(token:number){
 try{
  if(!lease()){update({...snapshot,phase:'paused',error:'另一个标签页正在修复；请返回那个页面继续。'});return}
  if(snapshot.total===0&&snapshot.processed===0){
   let total=0;
   for(const babyId of snapshot.babyIds){
    if(!active(token))return;
    total+=(await batch(babyId,'')).remaining;
   }
   update({...snapshot,total});
  }
  while(active(token)&&snapshot.babyIndex<snapshot.babyIds.length){
   await visible();
   if(!active(token))break;
   if(!lease()){update({...snapshot,phase:'paused',error:'另一个标签页正在执行修复。'});break}
   const babyId=snapshot.babyIds[snapshot.babyIndex];
   const result=await batch(babyId,snapshot.after);
   if(!result.items.length){
    update({...snapshot,babyIndex:snapshot.babyIndex+1,after:''});
    continue;
   }
   for(const item of result.items){
    if(!active(token))break;
    await visible();
    if(!active(token))break;
    let ok=false;
    try{await repair(item);ok=true}catch{/* Unsupported codecs and transient failures are counted, never mark ready. */}
    if(!active(token))break;
    update({...snapshot,after:item.id,processed:snapshot.processed+1,
     repaired:snapshot.repaired+Number(ok),failed:snapshot.failed+Number(!ok),error:''});
    // Yield to React/UI events between media. Only one decoder runs at a time.
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  if(active(token))update({...snapshot,phase:'completed'});
 }catch(e){
  if(active(token))update({...snapshot,phase:'paused',error:e instanceof Error?e.message:'网络中断，请继续修复'});
 }finally{
  running=false;
  releaseLease();
  // A user may press Resume while the previous decode is still finishing.
  if(snapshot.phase==='running')begin();
 }
}
function begin(){
 if(running||snapshot.phase!=='running')return;
 running=true;
 const token=++currentRun;
 void execute(token);
}
export function startThumbnailRepair(babyIds:string[]){
 const ids=[...new Set(babyIds)].filter(Boolean);
 if(!ids.length)return;
 if(running){
  if(snapshot.phase==='paused'&&sameBabies(ids))update({...snapshot,phase:'running',error:''});
  return;
 }
 // Explicit clicks after completion start a new scan (including former failures).
 const reuse=sameBabies(ids)&&snapshot.phase==='paused';
 update(reuse?{...snapshot,phase:'running',error:''}:{...empty(),phase:'running',babyIds:ids});
 begin();
}
export function resumeThumbnailRepair(babyIds:string[]){
 if(snapshot.phase!=='running')return;
 if(!sameBabies(babyIds)){
  update({...snapshot,phase:'paused',error:'宝宝列表已变化，请重新开始本轮封面扫描。'});
  return;
 }
 begin();
}
export function pauseThumbnailRepair(){
 currentRun++;
 update({...snapshot,phase:'paused',error:''});
 releaseLease();
}
export function clearThumbnailRepair(){
 currentRun++;
 running=false;
 snapshot=empty();
 try{localStorage.removeItem(key)}catch{}
 releaseLease();
 emit();
}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{
 if(event.key===key&&!running){snapshot=load();emit()}
});
