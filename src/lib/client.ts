export type BabyInfo={id:string;name:string;birthday:string;birth_time:string;gender:string;time_zone:string;allergies:string;notes:string};
export type BabyCounts={growth:number;milestones:number;media:number};
export type WechatRunStatus={connectionId:string;connected:boolean;enabled:boolean;unavailable?:boolean;lastPoll:string|null;lastMessage:string|null;lastError:string|null;startedAt?:string|null;media?:{pending:number;saving:boolean;notifying?:boolean;retrying:boolean;lastError:{code:string;attempt:number;at:string}|null;lastCompleted:string|null}};
export type State={ownerName:string;familyName:string;babies:BabyInfo[];counts:BabyCounts;countsByBaby:Record<string,BabyCounts>;openrouter:{configured:boolean;managedByDeployment:boolean;model:string};wechat:{connected:boolean;enabled:boolean;defaultBabyId:string;connections:{id:string;label:string;enabled:boolean;createdAt:string;updatedAt:string}[]}};
export type Tab='overview'|'growth'|'moments'|'album'|'settings';
export type RecordItem={id:string;day:string;weight?:number|null;height?:number|null;head_circumference?:number|null;title?:string;description?:string;notes?:string};
export class ApiFailure extends Error { constructor(readonly status:number,message:string){super(message);this.name='ApiFailure'} }
export async function api<T=any>(url:string, init?:RequestInit):Promise<T>{
 const r=await fetch(url,{credentials:'same-origin',...init,headers:{...(init?.body&&!(init.body instanceof Blob)?{'Content-Type':'application/json'}:{}),...init?.headers}});
 let data:any={};try{data=await r.json();}catch{}
 if(!r.ok)throw new ApiFailure(r.status,typeof data.error==='string'?data.error:'HTTP_'+r.status);
 return data as T;
}
export async function post<T=any>(url:string,body:unknown):Promise<T>{return api<T>(url,{method:'POST',body:JSON.stringify(body)})}
export const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
export const emptyRecordForm=()=>({day:today(),weight:'',height:'',headCircumference:'',notes:'',title:'',description:'',requestId:crypto.randomUUID()});
export function readDraft(key:string){try{const raw=sessionStorage.getItem(key);return raw?{...emptyRecordForm(),...JSON.parse(raw)}:emptyRecordForm()}catch{return emptyRecordForm()}}
