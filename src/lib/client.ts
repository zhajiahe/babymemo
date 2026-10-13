export type BabyInfo={id:string;name:string;birthday:string;birth_time:string;gender:string;time_zone:string;allergies:string;notes:string;avatar_key?:string;updated_at?:string;pending?:boolean};
export type BabyCounts={growth:number;milestones:number;media:number};
export type WechatRunStatus={connectionId:string;connected:boolean;enabled:boolean;unavailable?:boolean;lastPoll:string|null;lastMessage:string|null;lastError:string|null;startedAt?:string|null;media?:{pending:number;saving:boolean;notifying?:boolean;retrying:boolean;lastError:{code:string;attempt:number;at:string}|null;lastCompleted:string|null}};
export type State={ownerName:string;familyName:string;babies:BabyInfo[];counts:BabyCounts;countsByBaby:Record<string,BabyCounts>;openrouter:{configured:boolean;managedByDeployment:boolean;model:string};wechat:{connected:boolean;enabled:boolean;defaultBabyId:string;connections:{id:string;label:string;enabled:boolean;createdAt:string;updatedAt:string}[]}};
export type Tab='overview'|'growth'|'moments'|'album'|'settings';
export type RecordItem={id:string;day:string;baby_id?:string;weight?:number|null;height?:number|null;head_circumference?:number|null;title?:string;description?:string;notes?:string;updated_at?:string;pending?:boolean;media?:import('../components/MediaViewer').MediaItem[]};
import {ApiFailure,friendlyError} from './errors';
import {cacheResource,cachedPath,readCached,writeOffline,suspendDevice} from '../offline';
export {ApiFailure,friendlyError};
export async function api<T=any>(url:string, init?:RequestInit):Promise<T>{
 if(url==='/api/state'&&localStorage.getItem('babymemo-logout-pending')==='yes'){
  if(!navigator.onLine)throw new ApiFailure(401,'LOGIN_REQUIRED');
  try{const logout=await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!logout.ok&&logout.status!==401)throw Error('LOGOUT_FAILED');localStorage.removeItem('babymemo-logout-pending')}catch{throw new ApiFailure(401,'LOGIN_REQUIRED')}
 }
 if(init&&['POST','PATCH','DELETE'].includes(init.method||'')){const queued=await writeOffline(url,init);if(queued)return queued as T}
 let r:Response;
 try{r=await fetch(url,{credentials:'same-origin',...init,headers:{...(init?.body&&!(init.body instanceof Blob)?{'Content-Type':'application/json'}:{}),...init?.headers}})}catch(e){if((!init?.method||init.method==='GET')&&cachedPath(url))return await readCached(url) as T;throw e}
 let data:any={};try{data=await r.json();}catch{}
 if(r.status===401)await suspendDevice().catch(()=>{});
 if(!r.ok){if(r.status>=500&&(!init?.method||init.method==='GET')&&cachedPath(url))try{return await readCached(url) as T}catch{};throw new ApiFailure(r.status,friendlyError(typeof data.error==='string'?data.error:'HTTP_'+r.status))}
 if(url==='/api/login'||url==='/api/bootstrap')localStorage.removeItem('babymemo-logout-pending');
 if((!init?.method||init.method==='GET')&&cachedPath(url))try{data=await cacheResource(url,data)}catch{/* Online reads remain usable when device storage is full. */}
 return data as T;
}
export async function post<T=any>(url:string,body:unknown):Promise<T>{return api<T>(url,{method:'POST',body:JSON.stringify(body)})}
export const today=(timeZone='Asia/Shanghai')=>new Date().toLocaleDateString('sv-SE',{timeZone});
export const emptyRecordForm=(timeZone='Asia/Shanghai')=>({day:today(timeZone),weight:'',height:'',headCircumference:'',notes:'',title:'',description:'',requestId:crypto.randomUUID()});
export function readDraft(key:string,timeZone='Asia/Shanghai'){try{const raw=localStorage.getItem(key)||sessionStorage.getItem(key);if(raw){localStorage.setItem(key,raw);sessionStorage.removeItem(key)}return raw?{...emptyRecordForm(timeZone),...JSON.parse(raw)}:emptyRecordForm(timeZone)}catch{return emptyRecordForm(timeZone)}}
