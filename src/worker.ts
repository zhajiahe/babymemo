import { Hono } from 'hono';
import type { Env, Baby } from './types';
import { applySession, authenticated, clearSession, login, owner, sameOrigin, setup } from './auth';
import { constantEqual, passwordHash, randomHex } from './crypto';
import { decryptSecret, encryptSecret, setSetting, setting } from './crypto';
import { generateQr, qrStatus, askOpenRouter, workerBot } from './wechat';
import { mediaDownloadHeader } from './media-filename.mjs';
import { finalizeUpload, FinalizeMismatchError } from './upload-finalize.mjs';
import { cleanupExpiredUploads } from './upload-cleanup.mjs';
export { WechatSession } from './wechat';

const app = new Hono<{Bindings:Env}>();
const fail = (c: any, status:number, error:string) => c.json({error},status);
const json = async (req: Request, limit=16_384):Promise<any> => {
  if(Number(req.headers.get('content-length'))>limit)throw Error('BODY_TOO_LARGE');
  const raw=await req.text();
  if(raw.length>limit)throw Error('BODY_TOO_LARGE');
  return JSON.parse(raw);
};
const dayOk = (s:unknown):s is string => {
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const day=new Date(s+'T00:00:00Z');
  return !Number.isNaN(day.getTime())&&day.toISOString().slice(0,10)===s;
};
const validNum=(v:unknown,min:number,max:number):boolean=>v===null||v===undefined||(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max);
const now=()=>new Date().toISOString();
const allowedMime=(s:string)=>/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm))$/.test(s);
const thumbKey=(id:string)=>'private/thumbnails/'+id+'.jpg';
const uploadFingerprintOk=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
async function babyExists(env:Env,id:string):Promise<boolean>{return !!await env.DB.prepare('SELECT id FROM babies WHERE id=?').bind(id).first();}
async function currentBaby(env:Env):Promise<Baby|null>{return (await env.DB.prepare('SELECT id,name,birthday,gender,time_zone,allergies,notes FROM babies ORDER BY created_at LIMIT 1').first<Baby>())??null;}
app.use('/api/*',async(c,next)=>{
  c.header('Cache-Control','private, no-store');
  c.header('X-Content-Type-Options','nosniff');
  c.header('Referrer-Policy','no-referrer');
  if(['POST','PATCH','PUT','DELETE'].includes(c.req.method)&&!sameOrigin(c))return fail(c,403,'ORIGIN_REJECTED');
  const path=c.req.path;
  if(!['/api/health','/api/bootstrap/status','/api/bootstrap','/api/login'].includes(path)&&!await authenticated(c))return fail(c,401,'LOGIN_REQUIRED');
  await next();
});
app.get('/api/health',async c=>{
  try{
    await c.env.DB.prepare('SELECT id FROM owner LIMIT 1').first();
    return c.json({ok:true,service:'babymemo',version:1});
  }catch{return fail(c,503,'DATABASE_UNAVAILABLE')}
});
app.get('/api/bootstrap/status',async c=>c.json({
  initialized:!!await owner(c.env),
  sessionConfigured:!!c.env.SESSION_SECRET&&c.env.SESSION_SECRET.length>=32,
  encryptionConfigured:!!c.env.DATA_KEY&&/^[a-f0-9]{64}$/i.test(c.env.DATA_KEY)
}));
app.post('/api/bootstrap',async c=>{
  try {
    const v=await json(c.req.raw);
    const id=await setup(c,{ownerName:String(v.ownerName??''),familyName:String(v.familyName??''),password:String(v.password??''),babyName:String(v.babyName??''),birthday:String(v.birthday??''),gender:String(v.gender??''),timeZone:String(v.timeZone??'Asia/Shanghai'),allergies:String(v.allergies??'')});
    return c.json({ok:true,babyId:id},201);
  }catch(e){return fail(c,400,e instanceof Error?e.message:'SETUP_FAILED');}
});
app.post('/api/login',async c=>{
  try {
    const v=await json(c.req.raw);
    if(typeof v.name!=='string'||typeof v.password!=='string'||v.password.length>128)return fail(c,400,'INVALID_INPUT');
    const ok=await login(c,v.name,v.password);
    return ok?c.json({ok:true}):fail(c,401,'INVALID_CREDENTIALS_OR_RATE_LIMIT');
  }catch{return fail(c,400,'INVALID_INPUT');}
});
app.post('/api/logout',c=>{clearSession(c);return c.json({ok:true});});
app.get('/api/state',async c=>{
  const [user,babies,growth,milestones,media,byBaby]=await Promise.all([
    owner(c.env),
    c.env.DB.prepare('SELECT id,name,birthday,gender,time_zone,allergies,notes FROM babies ORDER BY created_at').all(),
    c.env.DB.prepare('SELECT count(*) AS count FROM growth_records WHERE deleted_at IS NULL').first<{count:number}>(),
    c.env.DB.prepare('SELECT count(*) AS count FROM milestones WHERE deleted_at IS NULL').first<{count:number}>(),
    c.env.DB.prepare('SELECT count(*) AS count FROM media WHERE deleted_at IS NULL').first<{count:number}>(),
    c.env.DB.prepare("SELECT baby_id,kind,COUNT(*) AS total FROM (SELECT baby_id,'growth' AS kind FROM growth_records WHERE deleted_at IS NULL UNION ALL SELECT baby_id,'milestones' AS kind FROM milestones WHERE deleted_at IS NULL UNION ALL SELECT baby_id,'media' AS kind FROM media WHERE deleted_at IS NULL) GROUP BY baby_id,kind")
      .all<{baby_id:string;kind:'growth'|'milestones'|'media';total:number}>()
  ]);
  const [encryptedApiKey,encryptedBot,model,botOn,familyName] = await Promise.all([
    setting(c.env,'openrouter_key'),setting(c.env,'wechat_token'),setting(c.env,'openrouter_model'),setting(c.env,'wechat_enabled'),setting(c.env,'family_name')
  ]);
  const countsByBaby:Record<string,{growth:number;milestones:number;media:number}>={};
  for(const row of byBaby.results){
    countsByBaby[row.baby_id]??={growth:0,milestones:0,media:0};
    countsByBaby[row.baby_id][row.kind]=row.total;
  }
  return c.json({ownerName:user!.name,familyName:familyName||'家庭空间',babies:babies.results,counts:{growth:growth?.count??0,milestones:milestones?.count??0,media:media?.count??0},countsByBaby,
    openrouter:{configured:!!encryptedApiKey,model:model||'openai/gpt-4.1-mini'},
    wechat:{connected:!!encryptedBot,enabled:botOn==='true'}});
});
app.post('/api/babies',async c=>{
  try {
    const v=await json(c.req.raw);if(typeof v.name!=='string'||!v.name.trim()||v.name.length>80||!dayOk(v.birthday)||!['boy','girl','other'].includes(v.gender))return fail(c,400,'INVALID_BABY');
    const id=crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO babies(id,name,birthday,gender,time_zone,allergies,notes,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,v.name.trim(),v.birthday,v.gender,String(v.timeZone||'Asia/Shanghai'),String(v.allergies||'').slice(0,2000),'',now()).run();
    return c.json({id},201);
  }catch{return fail(c,400,'INVALID_INPUT');}
});
app.patch('/api/babies/:id',async c=>{
  const id=c.req.param('id');try{
    const v=await json(c.req.raw);
    if(typeof v.name!=='string'||!v.name.trim()||v.name.length>80||!dayOk(v.birthday))return fail(c,400,'INVALID_BABY');
    const r=await c.env.DB.prepare('UPDATE babies SET name=?,birthday=?,allergies=?,notes=? WHERE id=?').bind(v.name.trim(),v.birthday,String(v.allergies||'').slice(0,2000),String(v.notes||'').slice(0,4000),id).run();
    return r.meta.changes?c.json({ok:true}):fail(c,404,'NOT_FOUND');
  }catch{return fail(c,400,'INVALID_INPUT');}
});
app.get('/api/records/:kind',async c=>{
  const kind=c.req.param('kind');const table=kind==='growth'?'growth_records':kind==='milestones'?'milestones':null;
  if(!table)return fail(c,404,'NOT_FOUND');
  const babyId=c.req.query('babyId');if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const page=Math.min(1000,Math.max(0,Number.parseInt(c.req.query('page')||'0',10)||0));
  const r=await c.env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? AND deleted_at IS NULL ORDER BY day DESC,created_at DESC LIMIT 40 OFFSET ?').bind(babyId,page*40).all();
  return c.json({items:r.results,page,hasMore:r.results.length===40});
});
app.post('/api/records/:kind',async c=>{
  const kind=c.req.param('kind');if(kind!=='growth'&&kind!=='milestones')return fail(c,404,'NOT_FOUND');
  try {
    const v=await json(c.req.raw);
    if(typeof v.babyId!=='string'||!await babyExists(c.env,v.babyId)||!dayOk(v.day))return fail(c,400,'INVALID_BABY_OR_DATE');
    const id=crypto.randomUUID(),date=now();
    if(kind==='growth'){
      if(!validNum(v.weight,0.1,150)||!validNum(v.height,10,250)||!validNum(v.headCircumference,10,100)||[v.weight,v.height,v.headCircumference].every(x=>x===undefined||x===null))return fail(c,400,'INVALID_MEASUREMENTS');
      await c.env.DB.prepare('INSERT INTO growth_records(id,baby_id,day,weight,height,head_circumference,notes,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,v.babyId,v.day,v.weight??null,v.height??null,v.headCircumference??null,String(v.notes||'').slice(0,1500),date).run();
    }else{
      if(typeof v.title!=='string'||!v.title.trim()||v.title.length>120)return fail(c,400,'INVALID_TITLE');
      await c.env.DB.prepare('INSERT INTO milestones(id,baby_id,day,title,description,created_at) VALUES(?,?,?,?,?,?)').bind(id,v.babyId,v.day,v.title.trim(),String(v.description||'').slice(0,3000),date).run();
    }
    return c.json({id},201);
  }catch{return fail(c,400,'INVALID_INPUT');}
});
app.delete('/api/records/:kind/:id',async c=>{
  const table=c.req.param('kind')==='growth'?'growth_records':c.req.param('kind')==='milestones'?'milestones':null;
  if(!table)return fail(c,404,'NOT_FOUND');
  await c.env.DB.prepare('UPDATE '+table+' SET deleted_at=? WHERE id=? AND deleted_at IS NULL').bind(now(),c.req.param('id')).run();
  return c.json({ok:true});
});
app.get('/api/media',async c=>{
  const babyId=c.req.query('babyId');if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const page=Math.min(1000,Math.max(0,Number.parseInt(c.req.query('page')||'0',10)||0));
  const rows=await c.env.DB.prepare('SELECT id,baby_id,day,title,mime,size,thumbnail_ready,created_at,favorite FROM media WHERE baby_id=? AND deleted_at IS NULL ORDER BY day DESC,created_at DESC LIMIT 36 OFFSET ?').bind(babyId,page*36).all();
  return c.json({items:rows.results,hasMore:rows.results.length===36});
});
// Enumerate missing private derivatives in bounded batches across the *entire*
// album. Cursor advances even if a browser cannot decode a particular HEIC.
app.get('/api/media/thumbnail-backfill',async c=>{
  const babyId=c.req.query('babyId');
  if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const after=c.req.query('after')||'';
  if(after.length>80)return fail(c,400,'INVALID_CURSOR');
  const batch=await c.env.DB.prepare(
    "SELECT id,mime,size FROM media WHERE baby_id=? AND deleted_at IS NULL AND thumbnail_ready=0 AND mime LIKE 'image/%' AND id>? ORDER BY id LIMIT 10"
  ).bind(babyId,after).all<{id:string;mime:string;size:number}>();
  const count=await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM media WHERE baby_id=? AND deleted_at IS NULL AND thumbnail_ready=0 AND mime LIKE 'image/%'"
  ).bind(babyId).first<{total:number}>();
  return c.json({items:batch.results,remaining:count?.total||0,cursor:batch.results.at(-1)?.id||after});
});
// Resume after Safari reload by re-selecting the same local file. No public uploads.
app.get('/api/upload/pending',async c=>{
  const babyId=c.req.query('babyId');
  if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const sessions=await c.env.DB.prepare(
    'SELECT id,day,title,mime,size,fingerprint,created_at,updated_at FROM media_uploads WHERE baby_id=? ORDER BY created_at DESC LIMIT 30'
  ).bind(babyId).all<{id:string;day:string;title:string;mime:string;size:number;fingerprint:string;created_at:string}>();
  const items=await Promise.all(sessions.results.map(async session=>{
    const parts=await c.env.DB.prepare('SELECT part_number FROM media_upload_parts WHERE media_upload_id=? ORDER BY part_number')
      .bind(session.id).all<{part_number:number}>();
    return {...session,completedParts:parts.results.map(p=>p.part_number)};
  }));
  return c.json({items});
});
app.post('/api/upload/start',async c=>{
  try{
    const v=await json(c.req.raw);
    if(typeof v.babyId!=='string'||!await babyExists(c.env,v.babyId)||!dayOk(v.day)||typeof v.mime!=='string'||!allowedMime(v.mime)||!Number.isSafeInteger(v.size)||v.size<1||v.size>209715200||v.fingerprint!==undefined&&!uploadFingerprintOk(v.fingerprint))return fail(c,400,'INVALID_MEDIA');
    const id=crypto.randomUUID(),key='private/'+v.babyId+'/'+id;
    const handle=await c.env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType:v.mime}});
    await c.env.DB.prepare('INSERT INTO media_uploads(id,baby_id,object_key,upload_id,day,title,mime,size,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,v.babyId,key,handle.uploadId,v.day,String(v.title||'').slice(0,120),v.mime,v.size,v.fingerprint||'',now(),now()).run();
    return c.json({id,chunkSize:8388608},201);
  }catch{return fail(c,400,'UPLOAD_START_FAILED');}
});
app.put('/api/upload/:id/part/:number',async c=>{
  const id=c.req.param('id'),number=Number(c.req.param('number'));
  if(!Number.isInteger(number)||number<1||number>25)return fail(c,400,'INVALID_PART');
  const row=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first<{object_key:string;upload_id:string;size:number}>();
  if(!row)return fail(c,404,'UPLOAD_NOT_FOUND');
  const length=Number(c.req.header('content-length'));
  const expectedLength=Math.min(8388608,row.size-(number-1)*8388608);
  if(!Number.isSafeInteger(length)||expectedLength<=0||length!==expectedLength)return fail(c,413,'INVALID_PART_SIZE');
  try{
    const part=await c.env.MEDIA.resumeMultipartUpload(row.object_key,row.upload_id).uploadPart(number,c.req.raw.body!);
    await c.env.DB.prepare('INSERT INTO media_upload_parts(media_upload_id,part_number,etag) VALUES(?,?,?) ON CONFLICT(media_upload_id,part_number) DO UPDATE SET etag=excluded.etag').bind(id,number,part.etag).run();
    await c.env.DB.prepare('UPDATE media_uploads SET updated_at=? WHERE id=?').bind(now(),id).run();
    return c.json({ok:true,partNumber:number});
  }catch{return fail(c,502,'UPLOAD_PART_FAILED');}
});
// Clean up incomplete R2 multipart uploads after a failed mobile transfer.
app.post('/api/upload/:id/cancel',async c=>{
  const id=c.req.param('id');
  const row=await c.env.DB.prepare('SELECT object_key,upload_id FROM media_uploads WHERE id=?').bind(id).first<{object_key:string;upload_id:string}>();
  if(!row)return fail(c,404,'UPLOAD_NOT_FOUND');
  try{
    // A completed R2 object awaiting D1 commit must not be silently discarded.
    if(await c.env.MEDIA.head(row.object_key))return fail(c,409,'UPLOAD_READY_TO_FINISH');
    try {
      await c.env.MEDIA.resumeMultipartUpload(row.object_key,row.upload_id).abort();
    } catch (error) {
      if(await c.env.MEDIA.head(row.object_key))return fail(c,409,'UPLOAD_READY_TO_FINISH');
      throw error;
    }
    await c.env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(id).run();
    return c.json({ok:true});
  }catch{return fail(c,502,'UPLOAD_CANCEL_FAILED');}
});
app.post('/api/upload/:id/finish',async c=>{
  const id=c.req.param('id');
  const recorded=async()=>!!await c.env.DB.prepare('SELECT id FROM media WHERE id=?').bind(id).first();
  try {
    // A lost 201 response must never start another multipart completion.
    if(await recorded())return c.json({id,completed:true,alreadyCompleted:true},200);
    const row=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first<{object_key:string;upload_id:string;size:number;baby_id:string;day:string;title:string;mime:string}>();
    if(!row)return fail(c,404,'UPLOAD_NOT_FOUND');
    const parts=await c.env.DB.prepare('SELECT part_number AS partNumber,etag FROM media_upload_parts WHERE media_upload_id=? ORDER BY part_number').bind(id).all<{partNumber:number;etag:string}>();
    const expected=Math.ceil(row.size/8388608);
    if(parts.results.length!==expected||parts.results.some((p,i)=>p.partNumber!==i+1))return fail(c,400,'UPLOAD_INCOMPLETE');
    await c.env.DB.prepare('UPDATE media_uploads SET updated_at=? WHERE id=?').bind(now(),id).run();
    const result=await finalizeUpload({
      bucket:c.env.MEDIA,row,parts:parts.results,isRecorded:recorded,
      persist:async()=>{
        await c.env.DB.batch([
          c.env.DB.prepare('INSERT INTO media(id,baby_id,day,title,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,row.baby_id,row.day,row.title,row.object_key,row.mime,row.size,now()),
          c.env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(id)
        ]);
      }
    });
    return c.json({id,completed:true,recovered:result.recovered},result.recovered?200:201);
  }catch(e){
    if(e instanceof FinalizeMismatchError)return fail(c,409,e.message);
    return fail(c,502,'UPLOAD_FINISH_FAILED');
  }
});
// Private R2 JPEG derivative: no public bucket and no new image service.
// Existing media lacking thumbnails automatically fall back to the original.
app.get('/api/media/:id/thumbnail',async c=>{
  const id=c.req.param('id');
  const row=await c.env.DB.prepare('SELECT object_key,mime FROM media WHERE id=? AND deleted_at IS NULL').bind(id).first<{object_key:string;mime:string}>();
  if(!row||!row.mime.startsWith('image/'))return fail(c,404,'NOT_FOUND');
  const thumb=await c.env.MEDIA.get(thumbKey(id));
  const obj=thumb||await c.env.MEDIA.get(row.object_key);
  if(!obj)return fail(c,404,'NOT_FOUND');
  return new Response(obj.body,{headers:{
    'Content-Type':thumb?'image/jpeg':row.mime,'Content-Length':String(obj.size),
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
  }});
});
// Thumbnail is optional: its failure must never invalidate an uploaded original.
app.put('/api/media/:id/thumbnail',async c=>{
  const id=c.req.param('id');
  const row=await c.env.DB.prepare('SELECT mime FROM media WHERE id=? AND deleted_at IS NULL').bind(id).first<{mime:string}>();
  if(!row||!row.mime.startsWith('image/'))return fail(c,404,'NOT_FOUND');
  const max=524288;
  const size=Number(c.req.header('content-length')||0);
  if(size>max)return fail(c,413,'THUMBNAIL_TOO_LARGE');
  if(c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()!=='image/jpeg')return fail(c,415,'INVALID_THUMBNAIL');
  const reader=c.req.raw.body?.getReader();
  if(!reader)return fail(c,400,'EMPTY_THUMBNAIL');
  const chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>max){await reader.cancel();return fail(c,413,'THUMBNAIL_TOO_LARGE');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  if(total<4)return fail(c,400,'INVALID_THUMBNAIL');
  const data=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  if(data[0]!==255||data[1]!==216||data[2]!==255||data[total-2]!==255||data[total-1]!==217)
    return fail(c,400,'INVALID_THUMBNAIL');
  await c.env.MEDIA.put(thumbKey(id),data,{httpMetadata:{contentType:'image/jpeg'}});
  await c.env.DB.prepare('UPDATE media SET thumbnail_ready=1 WHERE id=?').bind(id).run();
  return c.json({ok:true});
});
// Metadata edits never alter the private R2 object.
app.patch('/api/media/:id',async c=>{
  let value:unknown;
  try{value=await json(c.req.raw)}catch{return fail(c,400,'INVALID_INPUT')}
  if(!value||typeof value!=='object')return fail(c,400,'INVALID_MEDIA_METADATA');
  const v=value as Record<string,unknown>;
  if(typeof v.title!=='string'||!v.title.trim()||v.title.trim().length>120||!dayOk(v.day))return fail(c,400,'INVALID_MEDIA_METADATA');
  const record=await c.env.DB.prepare('SELECT id FROM media WHERE id=? AND deleted_at IS NULL').bind(c.req.param('id')).first();
  if(!record)return fail(c,404,'NOT_FOUND');
  await c.env.DB.prepare('UPDATE media SET title=?,day=? WHERE id=? AND deleted_at IS NULL').bind(v.title.trim(),v.day,c.req.param('id')).run();
  return c.json({ok:true});
});
app.get('/api/media/:id/content',async c=>{
  const row=await c.env.DB.prepare('SELECT object_key,mime,title FROM media WHERE id=? AND deleted_at IS NULL').bind(c.req.param('id')).first<{object_key:string;mime:string;title:string}>();
  if(!row)return fail(c,404,'NOT_FOUND');
  const range=c.req.header('Range');let options: R2GetOptions|undefined;
  if(range){
    const m=/^bytes=(\d+)-(\d*)$/.exec(range);
    if(!m)return fail(c,416,'INVALID_RANGE');
    const offset=Number(m[1]),end=m[2]?Number(m[2]):undefined;
    if(!Number.isSafeInteger(offset)||end!==undefined&&(!Number.isSafeInteger(end)||end<offset))return fail(c,416,'INVALID_RANGE');
    options={range:{offset,length:end!==undefined?end-offset+1:undefined}};
  }
  const obj=await c.env.MEDIA.get(row.object_key,options);
  if(!obj)return fail(c,404,'NOT_FOUND');
  const headers=new Headers({'Content-Type':row.mime,'Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'});
  if(c.req.query('download')==='1')headers.set('Content-Disposition',mediaDownloadHeader(row.title,row.mime));
  if(range&&obj.range){
    const offset=('offset' in obj.range?obj.range.offset:0)||0;
    const length=('length' in obj.range?obj.range.length:obj.size-offset)||0;
    headers.set('Content-Range','bytes '+offset+'-'+(offset+length-1)+'/'+obj.size);
    headers.set('Content-Length',String(length));
    return new Response(obj.body,{status:206,headers});
  }
  headers.set('Content-Length',String(obj.size));
  return new Response(obj.body,{headers});
});
app.delete('/api/media/:id',async c=>{
  const result=await c.env.DB.prepare('UPDATE media SET deleted_at=? WHERE id=? AND deleted_at IS NULL').bind(now(),c.req.param('id')).run();
  return result.meta.changes?c.json({ok:true,undoable:true}):fail(c,404,'NOT_FOUND');
});
// Recoverable deletion: content remains private and is purged after 30 days.
const trashTables:{[kind:string]:string}={growth:'growth_records',milestones:'milestones',media:'media'};
app.get('/api/trash',async c=>{
  const [growth,milestones,media]=await Promise.all([
    c.env.DB.prepare('SELECT id,baby_id,day,deleted_at,weight,height FROM growth_records WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100').all(),
    c.env.DB.prepare('SELECT id,baby_id,day,deleted_at,title FROM milestones WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100').all(),
    c.env.DB.prepare('SELECT id,baby_id,day,deleted_at,title,mime FROM media WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100').all()
  ]);
  return c.json({growth:growth.results,milestones:milestones.results,media:media.results,retentionDays:30});
});
app.post('/api/trash/:kind/:id/restore',async c=>{
  const table=trashTables[c.req.param('kind')];if(!table)return fail(c,404,'NOT_FOUND');
  const result=await c.env.DB.prepare('UPDATE '+table+' SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL').bind(c.req.param('id')).run();
  return result.meta.changes?c.json({ok:true}):fail(c,404,'NOT_FOUND');
});
app.get('/api/export/records',async c=>{
  const [babies,growth,milestones,media]=await Promise.all([
    c.env.DB.prepare('SELECT id,name,birthday,gender,time_zone,allergies,notes,created_at FROM babies').all(),
    c.env.DB.prepare('SELECT * FROM growth_records').all(),
    c.env.DB.prepare('SELECT * FROM milestones').all(),
    c.env.DB.prepare('SELECT id,baby_id,day,title,mime,size,created_at,deleted_at,favorite FROM media').all()
  ]);
  return c.json({schema:'babymemo-family-export-v1',exportedAt:now(),babies:babies.results,growth:growth.results,milestones:milestones.results,media:media.results,
    note:'Metadata export only. Original media require authenticated downloads or operator R2 backup; this file alone is not a full disaster-recovery backup.'});
});
app.post('/api/settings/password',async c=>{
  try{
    const v=await json(c.req.raw);
    if(typeof v.currentPassword!=='string'||typeof v.newPassword!=='string'||v.newPassword.length<6||v.newPassword.length>128)return fail(c,400,'INVALID_PASSWORD');
    const existing=await owner(c.env);if(!existing)return fail(c,409,'NOT_INITIALIZED');
    const current=await passwordHash(v.currentPassword,existing.password_salt);
    if(!constantEqual(current,existing.password_hash))return fail(c,403,'WRONG_CURRENT_PASSWORD');
    const salt=randomHex(16),hash=await passwordHash(v.newPassword,salt);
    const result=await c.env.DB.prepare('UPDATE owner SET password_salt=?,password_hash=?,session_version=session_version+1 WHERE id=1 AND password_hash=?')
      .bind(salt,hash,existing.password_hash).run();
    if(!result.meta.changes)return fail(c,409,'PASSWORD_CHANGED_CONCURRENTLY');
    clearSession(c);return c.json({ok:true,reauthenticate:true});
  }catch{return fail(c,400,'PASSWORD_CHANGE_FAILED');}
});
app.post('/api/settings/openrouter',async c=>{
  try{
    const v=await json(c.req.raw);
    if(typeof v.model!=='string'||!/^[\w./:-]{3,100}$/.test(v.model))return fail(c,400,'INVALID_MODEL');
    if(v.apiKey!==undefined){
      if(typeof v.apiKey!=='string'||!v.apiKey.startsWith('sk-or-')||v.apiKey.length>300)return fail(c,400,'INVALID_API_KEY');
      await setSetting(c.env,'openrouter_key',await encryptSecret(c.env,v.apiKey));
    }
    await setSetting(c.env,'openrouter_model',v.model);
    return c.json({ok:true});
  }catch{return fail(c,400,'DATA_KEY_OR_SETTINGS_ERROR');}
});
app.post('/api/settings/openrouter/test',async c=>{
  try{const answer=await askOpenRouter(c.env,'请只回复两个字：成功',undefined,true);return c.json({ok:true,answer});}
  catch(e){return fail(c,502,e instanceof Error?e.message:'OPENROUTER_FAILED');}
});
app.post('/api/chat',async c=>{
  try {
    const v=await json(c.req.raw);if(typeof v.message!=='string'||!v.message.trim()||v.message.length>2000)return fail(c,400,'INVALID_MESSAGE');
    const baby=v.babyId===undefined?await currentBaby(c.env):
      (typeof v.babyId==='string'?await c.env.DB.prepare('SELECT id,name,birthday,gender,time_zone,allergies,notes FROM babies WHERE id=?').bind(v.babyId).first<Baby>():null);
    if(!baby)return fail(c,400,'INVALID_BABY');
    const answer=await askOpenRouter(c.env,v.message,baby);
    return c.json({answer});
  }catch(e){return fail(c,502,e instanceof Error?e.message:'CHAT_FAILED');}
});
app.post('/api/settings/wechat/qr',async c=>{
  try{
    const info=await generateQr();
    await setSetting(c.env,'pairing_qr',await encryptSecret(c.env,info.code));
    await setSetting(c.env,'pairing_base','https://ilinkai.weixin.qq.com');
    return c.json({qrContent:info.content});
  }catch{return fail(c,502,'WECHAT_QR_FAILED');}
});
app.post('/api/settings/wechat/qr/status',async c=>{
  try{
    const v=await json(c.req.raw);const saved=await setting(c.env,'pairing_qr');
    if(!saved)return fail(c,400,'PAIRING_NOT_STARTED');
    const pairingBase=await setting(c.env,'pairing_base')||'https://ilinkai.weixin.qq.com';
    const result=await qrStatus(await decryptSecret(c.env,saved),typeof v.verifyCode==='string'?v.verifyCode:undefined,pairingBase);
    if(result.redirectBase)await setSetting(c.env,'pairing_base',result.redirectBase);
    if(result.status==='confirmed'){
      if(!result.botToken||!result.botId||!result.userId)return fail(c,502,'INVALID_WECHAT_CREDENTIALS');
      await setSetting(c.env,'wechat_token',await encryptSecret(c.env,result.botToken));
      await setSetting(c.env,'wechat_bot_id',result.botId);
      await setSetting(c.env,'wechat_user_id',result.userId);
      await setSetting(c.env,'wechat_base',result.base||'https://ilinkai.weixin.qq.com');
      await setSetting(c.env,'wechat_enabled','false');
      // A newly linked account must never reuse the previous bot's getupdates cursor.
      const reset=await workerBot(c.env).fetch('https://bot.internal/reset',{method:'POST'});
      if(!reset.ok)throw Error('WECHAT_RESET_FAILED');
      await setSetting(c.env,'pairing_qr','');
      return c.json({status:'confirmed'});
    }
    return c.json({status:result.status});
  }catch{return fail(c,502,'WECHAT_PAIRING_FAILED');}
});
app.post('/api/settings/wechat/:action',async c=>{
  const action=c.req.param('action');
  if(!['start','pause'].includes(action))return fail(c,404,'NOT_FOUND');
  if(action==='start'&&!await setting(c.env,'wechat_token'))return fail(c,409,'WECHAT_NOT_PAIRED');
  if(action==='start'&&!await setting(c.env,'openrouter_key'))return fail(c,409,'OPENROUTER_NOT_CONFIGURED');
  await setSetting(c.env,'wechat_enabled',action==='start'?'true':'false');
  const result=await workerBot(c.env).fetch('https://bot.internal/'+action,{method:'POST'});
  if(!result.ok){
    if(action==='start')await setSetting(c.env,'wechat_enabled','false');
    return fail(c,502,'WECHAT_BOT_UPDATE_FAILED');
  }
  return c.json({ok:true,status:action});
});
app.get('/api/settings/wechat/status',async c=>{
  const response=await workerBot(c.env).fetch('https://bot.internal/status');
  return c.json(await response.json());
});
app.onError((e,c)=>{
  console.error(JSON.stringify({level:'error',code:'UNHANDLED_REQUEST',path:c.req.path})); 
  return fail(c,500,'INTERNAL_ERROR');
});
export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(purgeDeleted(env).catch(()=>console.error(JSON.stringify({level:'error',event:'TRASH_PURGE_FAILED'}))));
    ctx.waitUntil(cleanupExpiredUploads({
      env,
      olderThan:new Date(Date.now()-14*86400000).toISOString(),
      limit:30,
      finalizeUpload
    }).then(stats=>console.log(JSON.stringify({level:'info',event:'UPLOAD_RETENTION',...stats})))
    .catch(()=>console.error(JSON.stringify({level:'error',event:'UPLOAD_RETENTION_FAILED'}))));
  }
};

// Deletion is reversible for 30 days. Only tombstoned originals may be physically removed.
async function purgeDeleted(env:Env):Promise<void>{
  const cutoff=new Date(Date.now()-30*86400000).toISOString();
  const expired=await env.DB.prepare('SELECT id,object_key FROM media WHERE deleted_at IS NOT NULL AND deleted_at<? ORDER BY deleted_at LIMIT 30').bind(cutoff).all<{id:string;object_key:string}>();
  for(const row of expired.results){
    await env.MEDIA.delete([row.object_key,thumbKey(row.id)]);
    await env.DB.prepare('DELETE FROM media WHERE id=? AND deleted_at<?').bind(row.id,cutoff).run();
  }
  for(const table of ['growth_records','milestones']){
    await env.DB.prepare('DELETE FROM '+table+' WHERE deleted_at IS NOT NULL AND deleted_at<?').bind(cutoff).run();
  }
}
