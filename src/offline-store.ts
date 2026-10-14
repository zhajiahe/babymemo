export const OFFLINE_DATABASE='babymemo-device-v1';
export const PRIVATE_MEDIA_CACHE='babymemo-private-media-v1';
export function openDeviceDatabase():Promise<IDBDatabase>{
 return new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(OFFLINE_DATABASE,1);
  request.onupgradeneeded=()=>{for(const store of ['resources','jobs'])if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,{keyPath:'id'})};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
export async function deviceRead<T=any>(store:string,id:string):Promise<T|undefined>{const db=await openDeviceDatabase();try{return await new Promise<T|undefined>((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}finally{db.close()}}
export async function deviceList<T=any>(store:string):Promise<T[]>{const db=await openDeviceDatabase();try{return await new Promise<T[]>((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}finally{db.close()}}
export async function deviceWrite(store:string,value:unknown):Promise<void>{const db=await openDeviceDatabase();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
export async function deviceRemove(store:string,id:string):Promise<void>{const db=await openDeviceDatabase();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
export async function deviceClear(stores:string[]=['resources','jobs']):Promise<void>{const db=await openDeviceDatabase();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');for(const store of stores)tx.objectStore(store).clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}finally{db.close()}}

export function projectMutation<T>(resource:{id:string;value:T},job:{id:string;path:string;method:string;kind:string;payload:Record<string,any>;file?:Blob}):{id:string;value:T}{
 const value:any=structuredClone(resource.value),url=new URL(resource.id,'https://local.invalid'),body=job.payload||{},path=job.path;
 const match=path.match(/^\/api\/records\/(growth|milestones)(?:\/([^/]+))?$/);
 const mediaMatch=path.match(/^\/api\/media\/([^/]+)$/);
 const babyMatch=path.match(/^\/api\/babies(?:\/([^/]+))?$/);
 const avatarMatch=path.match(/^\/api\/babies\/([^/]+)\/avatar$/);
 const rowId=match?.[2]||mediaMatch?.[1]||babyMatch?.[1]||body.requestId||job.id;
 const pending='pending:'+job.id;
 const dayMatch=(row:any)=>{const from=url.searchParams.get('startDay'),to=url.searchParams.get('endDay');return (!from||row.day>=from)&&(!to||row.day<=to)};
 if(match&&(url.pathname==='/api/records/'+match[1]||match[1]==='growth'&&url.pathname==='/api/growth/history')&&url.searchParams.get('babyId')===body.babyId){
  const existing=value.items.find((row:any)=>row.id===rowId);
  value.items=value.items.filter((row:any)=>row.id!==rowId);
  if(job.method!=='DELETE'&&(existing||job.method==='POST'&&Number(url.searchParams.get('page')||0)===0)){
   const row={...existing,id:rowId,baby_id:body.babyId,...body,head_circumference:body.headCircumference,updated_at:pending,pending:true};
   const q=url.searchParams.get('q');
   if(dayMatch(row)&&(!q||String(row.notes||row.title+' '+row.description).includes(q)))value.items.push(row);
   value.items.sort((a:any,b:any)=>url.pathname==='/api/growth/history'?a.day.localeCompare(b.day):b.day.localeCompare(a.day));
  }
 }
 if(mediaMatch&&url.pathname==='/api/media'){
  value.items=value.items.flatMap((row:any)=>row.id!==rowId?[row]:job.method==='DELETE'?[]:[{...row,...body,updated_at:pending,pending:true}]).filter(dayMatch);
 }
 if(job.kind==='media'&&url.pathname==='/api/media'&&url.searchParams.get('babyId')===body.babyId){
  const row={id:job.id,baby_id:body.babyId,day:body.day,title:body.title,description:body.description||'',mime:body.mime,size:job.file?.size??0,updated_at:pending,pending:true};
  if(dayMatch(row)&&!value.items.some((x:any)=>x.id===row.id))value.items.unshift(row);
 }
 if(babyMatch&&url.pathname==='/api/state'){
  const existing=value.babies.find((row:any)=>row.id===rowId);
  if(job.method==='POST'&&!existing)value.babies.push({id:rowId,...body,birth_time:body.birthTime||'',time_zone:body.timeZone||'Asia/Shanghai',notes:body.notes||'',avatar_key:'',updated_at:pending,pending:true});
  else if(job.method==='PATCH')value.babies=value.babies.map((row:any)=>row.id===rowId?{...row,...body,birth_time:body.birthTime,time_zone:body.timeZone,updated_at:pending,pending:true}:row);
  else if(job.method==='DELETE')value.babies=value.babies.filter((row:any)=>row.id!==rowId);
 }
 if(job.kind==='avatar'&&url.pathname==='/api/state')value.babies=value.babies.map((row:any)=>row.id===body.babyId?{...row,avatar_key:'pending:'+job.id,updated_at:pending,pending:true}:row);
 if(avatarMatch&&job.method==='DELETE'&&url.pathname==='/api/state')value.babies=value.babies.map((row:any)=>row.id===avatarMatch[1]?{...row,avatar_key:'',updated_at:pending,pending:true}:row);
 if(url.pathname==='/api/records/'+match?.[1]+'/'+rowId&&match&&job.method==='PATCH')Object.assign(value,body,{head_circumference:body.headCircumference,updated_at:pending,pending:true});
 return {...resource,value:value as T};
}
