import { Hono } from 'hono';
import type { Env, Baby,ApplicationEnv } from './types';
import {validCalendarDay,validTimeZone} from './validation';
import {DEFAULT_OPENROUTER_MODEL} from './openrouter-model.mjs';
import {DEFAULT_QWEN_MODEL,DEFAULT_AI_PROVIDER} from './qwen-workers-ai.mjs';
import { applySession, authenticated, clearSession, login, owner, sameOrigin, setup } from './auth';
import { constantEqual, passwordHash, randomHex } from './crypto';
import { decryptSecret, encryptSecret, setSetting, setting, deployedOpenRouterKey } from './crypto';
import { generateQr, qrStatus, testOpenRouterConnection, testWorkersAIConnection, workerBot } from './wechat';
import {getWechatConnection,listWechatConnections} from './wechat-connections';
import { mediaDownloadHeader } from './media-filename.mjs';
import { finalizeUpload, FinalizeMismatchError } from './upload-finalize.mjs';
import { cleanupExpiredUploads } from './upload-cleanup.mjs';
import {mediaTiming} from './media-timing.mjs';
import {canDirectUpload} from './media-transfer.mjs';
import {webManagement} from './web-management';
import {familySnapshot,completeFamilyExport,familyExportManifest} from './family-export';
import {previousMutation,commitMutation} from './web-mutations';
import {purgeDeletedMedia,retentionCutoff} from './media-retention.mjs';
export { WechatSession } from './wechat';

const app = new Hono<ApplicationEnv>();
const fail = (c: any, status:number, error:string) => c.json({error},status);
const json = async (req: Request, limit=16_384):Promise<any> => {
  if(Number(req.headers.get('content-length'))>limit)throw Error('BODY_TOO_LARGE');
  const raw=await req.text();
  if(raw.length>limit)throw Error('BODY_TOO_LARGE');
  return JSON.parse(raw);
};
const dayOk=validCalendarDay;
const validBirthTime=(v:unknown):v is string=>typeof v==='string'&&(v===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(v));
const validNum=(v:unknown,min:number,max:number):boolean=>v===null||v===undefined||(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max);
const now=()=>new Date().toISOString();
const allowedMime=(s:string)=>/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm))$/.test(s);
const thumbKey=(id:string)=>'private/thumbnails/'+id+'.jpg';
const uploadFingerprintOk=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
async function babyExists(env:Env,id:string):Promise<boolean>{return !!await env.DB.prepare('SELECT id FROM babies WHERE id=? AND archived_at IS NULL').bind(id).first();}
async function currentBaby(env:Env):Promise<Baby|null>{return (await env.DB.prepare('SELECT id,name,birthday,birth_time,gender,time_zone,allergies,notes,avatar_key,updated_at FROM babies WHERE archived_at IS NULL ORDER BY created_at LIMIT 1').first<Baby>())??null;}
app.use('/api/*',async(c,next)=>{
  c.header('Cache-Control','private, no-store');
  c.header('X-Content-Type-Options','nosniff');
  c.header('Referrer-Policy','no-referrer');
  if(['POST','PATCH','PUT','DELETE'].includes(c.req.method)&&!sameOrigin(c))return fail(c,403,'ORIGIN_REJECTED');
  const path=c.req.path;
  if(!['/api/health','/api/bootstrap/status','/api/bootstrap','/api/login'].includes(path)&&!await authenticated(c))return fail(c,401,'LOGIN_REQUIRED');
  if(['POST','PATCH','DELETE'].includes(c.req.method)){
   try{const previous=await previousMutation(c);if(previous)return c.json(previous)}catch(e){return fail(c,409,e instanceof Error?e.message:'REQUEST_ID_CONFLICT')}
  }
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
    const id=await setup(c,{ownerName:String(v.ownerName??''),familyName:String(v.familyName??''),password:String(v.password??''),babyName:String(v.babyName??''),birthday:String(v.birthday??''),birthTime:String(v.birthTime??''),gender:String(v.gender??''),timeZone:String(v.timeZone??'Asia/Shanghai'),allergies:String(v.allergies??'')});
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
    c.env.DB.prepare('SELECT id,name,birthday,birth_time,gender,time_zone,allergies,notes,avatar_key,updated_at FROM babies WHERE archived_at IS NULL ORDER BY created_at').all(),
    c.env.DB.prepare('SELECT count(*) AS count FROM growth_records WHERE deleted_at IS NULL').first<{count:number}>(),
    c.env.DB.prepare('SELECT count(*) AS count FROM milestones WHERE deleted_at IS NULL').first<{count:number}>(),
    c.env.DB.prepare('SELECT count(*) AS count FROM media WHERE deleted_at IS NULL').first<{count:number}>(),
    c.env.DB.prepare("SELECT baby_id,kind,COUNT(*) AS total FROM (SELECT baby_id,'growth' AS kind FROM growth_records WHERE deleted_at IS NULL UNION ALL SELECT baby_id,'milestones' AS kind FROM milestones WHERE deleted_at IS NULL UNION ALL SELECT baby_id,'media' AS kind FROM media WHERE deleted_at IS NULL) GROUP BY baby_id,kind")
      .all<{baby_id:string;kind:'growth'|'milestones'|'media';total:number}>()
  ]);
  const [encryptedApiKey,model,familyName,connections,providerPref] = await Promise.all([
    setting(c.env,'openrouter_key'),setting(c.env,'openrouter_model'),setting(c.env,'family_name'),listWechatConnections(c.env),setting(c.env,'ai_provider')
  ]);
  const countsByBaby:Record<string,{growth:number;milestones:number;media:number}>={};
  for(const row of byBaby.results){
    countsByBaby[row.baby_id]??={growth:0,milestones:0,media:0};
    countsByBaby[row.baby_id][row.kind]=row.total;
  }
  return c.json({ownerName:user!.name,familyName:familyName||'家庭空间',babies:babies.results,counts:{growth:growth?.count??0,milestones:milestones?.count??0,media:media?.count??0},countsByBaby,
    ai:{provider:providerPref==='openrouter'?'openrouter':DEFAULT_AI_PROVIDER,model:DEFAULT_QWEN_MODEL,thinking:'off'},
    openrouter:{configured:!!encryptedApiKey||!!deployedOpenRouterKey(c.env),managedByDeployment:!!deployedOpenRouterKey(c.env),model:model||DEFAULT_OPENROUTER_MODEL},
    wechat:{connected:connections.length>0,enabled:connections.some(x=>x.enabled),connections,defaultBabyId:await setting(c.env,'wechat_default_baby_id')||''}});
});
app.post('/api/babies',async c=>{
  try {
    const v=await json(c.req.raw);if(typeof v.name!=='string'||!v.name.trim()||v.name.length>80||!dayOk(v.birthday)||!validBirthTime(v.birthTime??'')||!validTimeZone(v.timeZone||'Asia/Shanghai')||!['boy','girl','other'].includes(v.gender))return fail(c,400,'INVALID_BABY');
    const id=v.requestId||crypto.randomUUID();
    if(!/^[a-f0-9-]{36}$/i.test(id))return fail(c,400,'INVALID_REQUEST_ID');
    await commitMutation(c,c.env.DB.prepare('INSERT INTO babies(id,name,birthday,birth_time,gender,time_zone,allergies,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,v.name.trim(),v.birthday,v.birthTime??'',v.gender,String(v.timeZone||'Asia/Shanghai'),String(v.allergies||'').slice(0,2000),String(v.notes||'').slice(0,4000),now()),{id,updated_at:''});
    return c.json({id,updated_at:''},201);
  }catch{return fail(c,400,'INVALID_INPUT');}
});
app.patch('/api/babies/:id',async c=>{
 const id=c.req.param('id');try{
  const v=await json(c.req.raw);
  if(typeof v.name!=='string'||!v.name.trim()||v.name.length>80||!dayOk(v.birthday)||v.birthTime!==undefined&&!validBirthTime(v.birthTime)||v.gender!==undefined&&!['boy','girl','other'].includes(v.gender)||v.timeZone!==undefined&&!validTimeZone(v.timeZone)||v.expectedUpdatedAt!==undefined&&typeof v.expectedUpdatedAt!=='string')return fail(c,400,'INVALID_BABY');
  const existing=await c.env.DB.prepare('SELECT * FROM babies WHERE id=? AND archived_at IS NULL').bind(id).first<Baby>();
  if(!existing)return fail(c,404,'NOT_FOUND');
  const version=crypto.randomUUID();
  const result=await commitMutation(c,c.env.DB.prepare('UPDATE babies SET name=?,birthday=?,birth_time=?,gender=?,time_zone=?,allergies=?,notes=?,updated_at=? WHERE id=? AND archived_at IS NULL AND updated_at=?')
   .bind(v.name.trim(),v.birthday,v.birthTime??existing.birth_time,v.gender??existing.gender,v.timeZone??existing.time_zone,String(v.allergies??existing.allergies).slice(0,2000),String(v.notes??existing.notes).slice(0,4000),version,id,v.expectedUpdatedAt??existing.updated_at),{ok:true,updated_at:version});
  return result?c.json({ok:true,updated_at:version}):fail(c,409,'EDIT_CONFLICT');
 }catch{return fail(c,400,'INVALID_INPUT')}
});
app.get('/api/records/:kind',async c=>{
  const kind=c.req.param('kind');const table=kind==='growth'?'growth_records':kind==='milestones'?'milestones':null;
  if(!table)return fail(c,404,'NOT_FOUND');
  const babyId=c.req.query('babyId');if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const page=Math.min(1000,Math.max(0,Number.parseInt(c.req.query('page')||'0',10)||0));
  const q=(c.req.query('q')||'').trim(),start=c.req.query('startDay')||'',end=c.req.query('endDay')||'';
  if(q.length>80||start&&!dayOk(start)||end&&!dayOk(end)||start&&end&&start>end)return fail(c,400,'INVALID_SEARCH');
  const clauses=['baby_id=?','deleted_at IS NULL'],values:(string|number)[]=[babyId];
  if(start){clauses.push('day>=?');values.push(start)}if(end){clauses.push('day<=?');values.push(end)}
  if(q){clauses.push((kind==='growth'?'notes':"title||' '||description")+' LIKE ?');values.push('%'+q+'%')}
  const r=await c.env.DB.prepare('SELECT * FROM '+table+' WHERE '+clauses.join(' AND ')+' ORDER BY day DESC,created_at DESC LIMIT 40 OFFSET ?').bind(...values,page*40).all();
  const items=r.results as Record<string,unknown>[];
  if(kind==='milestones'&&items.length){
   const linked=await c.env.DB.prepare('SELECT mm.milestone_id,m.id,m.day,m.title,m.mime,m.size,m.thumbnail_ready,m.updated_at FROM milestone_media mm JOIN media m ON m.id=mm.media_id WHERE mm.milestone_id IN ('+items.map(()=>'?').join(',')+') AND m.baby_id=? AND m.deleted_at IS NULL').bind(...items.map(x=>String(x.id)),babyId).all<Record<string,unknown>>();
   for(const item of items)item.media=linked.results.filter(x=>x.milestone_id===item.id);
  }
  return c.json({items,page,hasMore:items.length===40});
});
app.get('/api/growth/history',async c=>{
  const babyId=c.req.query('babyId');if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const records=await c.env.DB.prepare('SELECT id,day,weight,height,head_circumference FROM growth_records WHERE baby_id=? AND deleted_at IS NULL ORDER BY day ASC,created_at ASC LIMIT 2000').bind(babyId).all();
  return c.json({items:records.results,limited:records.results.length===2000});
});
app.post('/api/records/:kind',async c=>{
  const kind=c.req.param('kind');if(kind!=='growth'&&kind!=='milestones')return fail(c,404,'NOT_FOUND');
  try {
    const v=await json(c.req.raw);
    if(typeof v.babyId!=='string'||!await babyExists(c.env,v.babyId)||!dayOk(v.day))return fail(c,400,'INVALID_BABY_OR_DATE');
    const requestId=v.requestId===undefined?null:v.requestId;
    if(requestId!==null&&(typeof requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(requestId)))return fail(c,400,'INVALID_REQUEST_ID');
    const table=kind==='growth'?'growth_records':'milestones';
    if(requestId){
      const previous=await c.env.DB.prepare('SELECT id,baby_id FROM '+table+' WHERE client_request_id=?').bind(requestId).first<{id:string;baby_id:string}>();
      if(previous)return previous.baby_id===v.babyId?c.json({id:previous.id,alreadyExists:true}):fail(c,409,'REQUEST_ID_CONFLICT');
    }
    const id=requestId||crypto.randomUUID(),date=now();
    if(kind==='growth'){
      if(!validNum(v.weight,0.1,150)||!validNum(v.height,10,250)||!validNum(v.headCircumference,10,100)||[v.weight,v.height,v.headCircumference].every(x=>x===undefined||x===null))return fail(c,400,'INVALID_MEASUREMENTS');
      await commitMutation(c,c.env.DB.prepare('INSERT OR IGNORE INTO growth_records(id,baby_id,day,weight,height,head_circumference,notes,created_at,client_request_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,v.babyId,v.day,v.weight??null,v.height??null,v.headCircumference??null,String(v.notes||'').slice(0,1500),date,requestId),{id,updated_at:''});
    }else{
      if(typeof v.title!=='string'||!v.title.trim()||v.title.length>120)return fail(c,400,'INVALID_TITLE');
      await commitMutation(c,c.env.DB.prepare('INSERT OR IGNORE INTO milestones(id,baby_id,day,title,description,created_at,client_request_id) VALUES(?,?,?,?,?,?,?)').bind(id,v.babyId,v.day,v.title.trim(),String(v.description||'').slice(0,3000),date,requestId),{id,updated_at:''});
    }
    if(requestId){
      const saved=await c.env.DB.prepare('SELECT id,baby_id FROM '+table+' WHERE client_request_id=?').bind(requestId).first<{id:string;baby_id:string}>();
      if(!saved)return fail(c,409,'RECORD_NOT_SAVED');
      if(saved.id!==id)return saved.baby_id===v.babyId?c.json({id:saved.id,alreadyExists:true}):fail(c,409,'REQUEST_ID_CONFLICT');
    }
    return c.json({id,updated_at:''},201);
  }catch{return fail(c,400,'INVALID_INPUT');}
});
app.delete('/api/records/:kind/:id',async c=>{
  const table=c.req.param('kind')==='growth'?'growth_records':c.req.param('kind')==='milestones'?'milestones':null;
  if(!table)return fail(c,404,'NOT_FOUND');
  const changes=await commitMutation(c,c.env.DB.prepare('UPDATE '+table+' SET deleted_at=? WHERE id=? AND deleted_at IS NULL').bind(now(),c.req.param('id')));
  if(!changes)return fail(c,404,'NOT_FOUND');
  return c.json({ok:true});
});
app.get('/api/media',async c=>{
  const babyId=c.req.query('babyId');if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const page=Math.min(1000,Math.max(0,Number.parseInt(c.req.query('page')||'0',10)||0));
  const query=(c.req.query('q')||'').trim(),start=c.req.query('startDay')||'',end=c.req.query('endDay')||'',type=c.req.query('type')||'';
  if(query.length>80||start&&!dayOk(start)||end&&!dayOk(end)||start&&end&&start>end||type&&!['image','video'].includes(type))return fail(c,400,'INVALID_SEARCH');
  const clauses=['baby_id=?','deleted_at IS NULL'],bindings:(string|number)[]=[babyId];
  if(query){clauses.push('(title LIKE ? OR description LIKE ?)');bindings.push('%'+query+'%','%'+query+'%')}
  if(start){clauses.push('day>=?');bindings.push(start)}if(end){clauses.push('day<=?');bindings.push(end)}
  if(type){clauses.push('mime LIKE ?');bindings.push(type+'/%')}
  const rows=await c.env.DB.prepare('SELECT id,baby_id,day,title,description,mime,size,thumbnail_ready,created_at,updated_at FROM media WHERE '+clauses.join(' AND ')+' ORDER BY day DESC,created_at DESC LIMIT 36 OFFSET ?').bind(...bindings,page*36).all();
  return c.json({items:rows.results,hasMore:rows.results.length===36});
});
// Enumerate missing private derivatives in bounded batches across the *entire*
// album. Cursor advances even if a browser cannot decode a particular HEIC.
app.get('/api/media/thumbnail-backfill',async c=>{
  const babyId=c.req.query('babyId');
  if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const after=c.req.query('after')||'';
  const type=c.req.query('type')||'image';
  if(after.length>80)return fail(c,400,'INVALID_CURSOR');
  if(type!=='image'&&type!=='all')return fail(c,400,'INVALID_TYPE');
  // Keep the manual legacy photo backfill image-only by default.
  const missing=type==='all'?"(mime LIKE 'image/%' OR mime LIKE 'video/%')":"mime LIKE 'image/%'";
  const batch=await c.env.DB.prepare(
    'SELECT id,mime,size FROM media WHERE baby_id=? AND deleted_at IS NULL AND thumbnail_ready=0 AND '+missing+' AND id>? ORDER BY id LIMIT 10'
  ).bind(babyId,after).all<{id:string;mime:string;size:number}>();
  const count=await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM media WHERE baby_id=? AND deleted_at IS NULL AND thumbnail_ready=0 AND '+missing
  ).bind(babyId).first<{total:number}>();
  return c.json({items:batch.results,remaining:count?.total||0,cursor:batch.results.at(-1)?.id||after});
});
// Opt-in, same-origin, PII-free browser-side elapsed time. Client durations
// include the phone-to-edge network leg; Worker R2 timings do not.
app.post('/api/upload/metrics',async c=>{
  try{
    const v=await json(c.req.raw,512);
    if(!v||!['client','thumbnail'].includes(v.stage)||
       !Number.isSafeInteger(v.size)||v.size<0||v.size>209715200||
       !Number.isFinite(v.durationMs)||v.durationMs<0||v.durationMs>600000||
       !['ok','error'].includes(v.status))return fail(c,400,'INVALID_UPLOAD_METRIC');
    mediaTiming({channel:'web',stage:v.stage,size:v.size,
      startedAt:performance.now()-v.durationMs,status:v.status});
    return c.json({ok:true});
  }catch{return fail(c,400,'INVALID_UPLOAD_METRIC')}
});
// Small-file fast path: one authenticated same-origin request, private R2
// storage, stable client UUID for retries and no Multipart start/finish RTTs.
// A D1 failure after R2 PUT can be recovered by the same upload UUID.
app.put('/api/upload/direct/:id',async c=>{
  const started=performance.now(),id=c.req.param('id');
  const babyId=c.req.header('x-baby-id')||'';
  const day=c.req.header('x-upload-day')||'';
  const mime=c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()||'';
  const size=Number(c.req.header('content-length'));
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||
     !dayOk(day)||!allowedMime(mime)||!canDirectUpload(size)||!await babyExists(c.env,babyId))
    return fail(c,400,'INVALID_DIRECT_MEDIA');
  let title='';
  try{title=decodeURIComponent(c.req.header('x-upload-title')||'').slice(0,120)}catch{return fail(c,400,'INVALID_DIRECT_MEDIA')}
  if(!title.trim())return fail(c,400,'INVALID_DIRECT_MEDIA');
  let description='';
  try{description=decodeURIComponent(c.req.header('x-upload-description')||'')}catch{return fail(c,400,'INVALID_DIRECT_MEDIA')}
  if(description.length>1000)return fail(c,400,'INVALID_MEDIA_DESCRIPTION');
  description=description.trim();
  const key='private/'+babyId+'/'+id;
  let phase='upload';
  try{
    const recorded=await c.env.DB.prepare('SELECT id,baby_id,mime,size FROM media WHERE id=?')
      .bind(id).first<{id:string;baby_id:string;mime:string;size:number}>();
    if(recorded){
      if(recorded.baby_id!==babyId||recorded.size!==size||recorded.mime!==mime)return fail(c,409,'UPLOAD_ID_CONFLICT');
      mediaTiming({channel:'web',stage:'direct',size,startedAt:started});
      return c.json({id,completed:true,alreadyCompleted:true});
    }
    let object=await c.env.MEDIA.head(key);
    if(object&&(object.size!==size||object.httpMetadata?.contentType!==mime))
      return fail(c,409,'UPLOAD_ID_CONFLICT');
    if(!object){
      if(!c.req.raw.body)return fail(c,400,'EMPTY_MEDIA');
      object=await c.env.MEDIA.put(key,c.req.raw.body,{httpMetadata:{contentType:mime}});
      if(!object||object.size!==size){
        await c.env.MEDIA.delete(key);
        return fail(c,413,'UPLOAD_SIZE_MISMATCH');
      }
    }
    phase='index';
    await c.env.DB.prepare('INSERT OR IGNORE INTO media(id,baby_id,day,title,description,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(id,babyId,day,title,description,key,mime,size,now()).run();
    const committed=await c.env.DB.prepare('SELECT id,baby_id,size FROM media WHERE id=?')
      .bind(id).first<{id:string;baby_id:string;size:number}>();
    if(!committed||committed.baby_id!==babyId||committed.size!==size)throw Error('DIRECT_INDEX_FAILED');
    mediaTiming({channel:'web',stage:'direct',size,startedAt:started});
    return c.json({id,completed:true},201);
  }catch{
    mediaTiming({channel:'web',stage:phase==='index'?'index':'direct',size,startedAt:started,status:'error'});
    return fail(c,502,'UPLOAD_DIRECT_FAILED');
  }
});
// Resume after Safari reload by re-selecting the same local file. No public uploads.
app.get('/api/upload/pending',async c=>{
  const babyId=c.req.query('babyId');
  if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const sessions=await c.env.DB.prepare(
    'SELECT id,day,title,description,mime,size,fingerprint,created_at,updated_at FROM media_uploads WHERE baby_id=? ORDER BY created_at DESC LIMIT 30'
  ).bind(babyId).all<{id:string;day:string;title:string;description:string;mime:string;size:number;fingerprint:string;created_at:string}>();
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
    if(typeof v.babyId!=='string'||!await babyExists(c.env,v.babyId)||!dayOk(v.day)||typeof v.mime!=='string'||!allowedMime(v.mime)||!Number.isSafeInteger(v.size)||v.size<1||v.size>209715200||v.fingerprint!==undefined&&!uploadFingerprintOk(v.fingerprint)||v.description!==undefined&&(typeof v.description!=='string'||v.description.length>1000))return fail(c,400,'INVALID_MEDIA');
    const id=v.requestId||crypto.randomUUID(),key='private/'+v.babyId+'/'+id;
    if(!/^[a-f0-9-]{36}$/i.test(id))return fail(c,400,'INVALID_REQUEST_ID');
    const recorded=await c.env.DB.prepare('SELECT baby_id,size,mime FROM media WHERE id=?').bind(id).first<{baby_id:string;size:number;mime:string}>();
    if(recorded)return recorded.baby_id===v.babyId&&recorded.size===v.size&&recorded.mime===v.mime?c.json({id,completed:true}):fail(c,409,'UPLOAD_ID_CONFLICT');
    const pending=await c.env.DB.prepare('SELECT baby_id,size,mime,fingerprint FROM media_uploads WHERE id=?').bind(id).first<{baby_id:string;size:number;mime:string;fingerprint:string}>();
    if(pending)return pending.baby_id===v.babyId&&pending.size===v.size&&pending.mime===v.mime&&pending.fingerprint===(v.fingerprint||'')?c.json({id,chunkSize:8388608}):fail(c,409,'UPLOAD_ID_CONFLICT');
    const handle=await c.env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType:v.mime}});
    try{await c.env.DB.prepare('INSERT INTO media_uploads(id,baby_id,object_key,upload_id,day,title,description,mime,size,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,v.babyId,key,handle.uploadId,v.day,String(v.title||'').slice(0,120),String(v.description||'').trim(),v.mime,v.size,v.fingerprint||'',now(),now()).run()}
    catch(e){await handle.abort().catch(()=>{});throw e}
    return c.json({id,chunkSize:8388608},201);
  }catch{return fail(c,400,'UPLOAD_START_FAILED');}
});
app.put('/api/upload/:id/part/:number',async c=>{
  const started=performance.now();
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
    mediaTiming({channel:'web',stage:'part',size:expectedLength,startedAt:started});
    return c.json({ok:true,partNumber:number});
  }catch{mediaTiming({channel:'web',stage:'part',size:expectedLength,startedAt:started,status:'error'});return fail(c,502,'UPLOAD_PART_FAILED');}
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
  const started=performance.now();
  const id=c.req.param('id');
  const recorded=async()=>!!await c.env.DB.prepare('SELECT id FROM media WHERE id=?').bind(id).first();
  try {
    // A lost 201 response must never start another multipart completion.
    if(await recorded())return c.json({id,completed:true,alreadyCompleted:true},200);
    const row=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first<{object_key:string;upload_id:string;size:number;baby_id:string;day:string;title:string;description:string;mime:string}>();
    if(!row)return fail(c,404,'UPLOAD_NOT_FOUND');
    const parts=await c.env.DB.prepare('SELECT part_number AS partNumber,etag FROM media_upload_parts WHERE media_upload_id=? ORDER BY part_number').bind(id).all<{partNumber:number;etag:string}>();
    const expected=Math.ceil(row.size/8388608);
    if(parts.results.length!==expected||parts.results.some((p,i)=>p.partNumber!==i+1))return fail(c,400,'UPLOAD_INCOMPLETE');
    await c.env.DB.prepare('UPDATE media_uploads SET updated_at=? WHERE id=?').bind(now(),id).run();
    const result=await finalizeUpload({
      bucket:c.env.MEDIA,row,parts:parts.results,isRecorded:recorded,
      persist:async()=>{
        await c.env.DB.batch([
          c.env.DB.prepare('INSERT INTO media(id,baby_id,day,title,description,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,row.baby_id,row.day,row.title,row.description||'',row.object_key,row.mime,row.size,now()),
          c.env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(id)
        ]);
      }
    });
    mediaTiming({channel:'web',stage:'finish',size:row.size,startedAt:started});
    return c.json({id,completed:true,recovered:result.recovered},result.recovered?200:201);
  }catch(e){
    mediaTiming({channel:'web',stage:'finish',size:0,startedAt:started,status:'error'});
    if(e instanceof FinalizeMismatchError)return fail(c,409,e.message);
    return fail(c,502,'UPLOAD_FINISH_FAILED');
  }
});
// Private R2 JPEG derivative: no public bucket and no new image service.
// Existing media lacking thumbnails automatically fall back to the original.
app.get('/api/media/:id/thumbnail',async c=>{
  const id=c.req.param('id');
  const row=await c.env.DB.prepare('SELECT object_key,mime FROM media WHERE id=? AND deleted_at IS NULL').bind(id).first<{object_key:string;mime:string}>();
  if(!row)return fail(c,404,'NOT_FOUND');
  const thumb=await c.env.MEDIA.get(thumbKey(id));
  const obj=thumb||(row.mime.startsWith('image/')?await c.env.MEDIA.get(row.object_key):null);
  if(!obj)return fail(c,404,'NOT_FOUND');
  const etag=obj.httpEtag||'"'+obj.etag+'"';
  const headers=new Headers({'Content-Type':thumb?'image/jpeg':row.mime,'Content-Length':String(obj.size),
    'Cache-Control':'private, no-cache, must-revalidate','X-Content-Type-Options':'nosniff','ETag':etag});
  if(c.req.header('If-None-Match')===etag)return new Response(null,{status:304,headers});
  return new Response(obj.body,{headers});
});
// Thumbnail is optional: its failure must never invalidate an uploaded original.
app.put('/api/media/:id/thumbnail',async c=>{
  const id=c.req.param('id');
  const row=await c.env.DB.prepare('SELECT mime FROM media WHERE id=? AND deleted_at IS NULL').bind(id).first<{mime:string}>();
  if(!row||(!row.mime.startsWith('image/')&&!row.mime.startsWith('video/')))return fail(c,404,'NOT_FOUND');
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
  if(!dayOk(v.day)||(v.title!==undefined&&(typeof v.title!=='string'||!v.title.trim()||v.title.trim().length>120))||
     v.description!==undefined&&(typeof v.description!=='string'||v.description.length>1000))return fail(c,400,'INVALID_MEDIA_METADATA');
  const record=await c.env.DB.prepare('SELECT id,baby_id,updated_at FROM media WHERE id=? AND deleted_at IS NULL AND purge_token IS NULL').bind(c.req.param('id')).first<{id:string;baby_id:string;updated_at:string}>();
  if(!record||v.babyId!==undefined&&v.babyId!==record.baby_id)return fail(c,404,'NOT_FOUND');
  const version=crypto.randomUUID();
  if(v.description!==undefined){
    const hasTitle=v.title!==undefined;
    const sql='UPDATE media SET '+(hasTitle?'title=?,':'')+'description=?,day=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND updated_at=?';
    const changes=await commitMutation(c,c.env.DB.prepare(sql)
      .bind(...(hasTitle?[String(v.title).trim()]:[]),String(v.description).trim(),v.day,version,c.req.param('id'),v.expectedUpdatedAt??record.updated_at),{ok:true,updated_at:version});
    if(!changes)return fail(c,409,'EDIT_CONFLICT');
  }else if(v.title!==undefined){
    const changes=await commitMutation(c,c.env.DB.prepare('UPDATE media SET title=?,day=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND updated_at=?').bind(v.title.trim(),v.day,version,c.req.param('id'),v.expectedUpdatedAt??record.updated_at),{ok:true,updated_at:version});
    if(!changes)return fail(c,409,'EDIT_CONFLICT');
  }else{
    const changes=await commitMutation(c,c.env.DB.prepare('UPDATE media SET day=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND updated_at=?').bind(v.day,version,c.req.param('id'),v.expectedUpdatedAt??record.updated_at),{ok:true,updated_at:version});
    if(!changes)return fail(c,409,'EDIT_CONFLICT');
  }
  return c.json({ok:true,updated_at:version});
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
  const result=await commitMutation(c,c.env.DB.prepare('UPDATE media SET deleted_at=? WHERE id=? AND deleted_at IS NULL AND purge_token IS NULL').bind(now(),c.req.param('id')));
  return result?c.json({ok:true,undoable:true}):fail(c,404,'NOT_FOUND');
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
  const result=await commitMutation(c,c.env.DB.prepare('UPDATE '+table+' SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL AND deleted_at>=?'+(table==='media'?' AND purge_token IS NULL':'')).bind(c.req.param('id'),retentionCutoff()));
  return result?c.json({ok:true}):fail(c,409,'RESTORE_EXPIRED_OR_UNAVAILABLE');
});
app.get('/api/export/records',async c=>c.json({...await familySnapshot(c.env),note:'Metadata only. Use /api/export/full for originals, avatars and existing thumbnails.'}));
app.get('/api/export/manifest',async c=>c.json(await familyExportManifest(c.env)));
app.get('/api/export/file',async c=>{
 const id=c.req.query('id'),kind=c.req.query('kind');if(!id||!['avatar','original','thumbnail'].includes(kind||''))return fail(c,400,'INVALID_EXPORT_FILE');
 let key:string|undefined;
 if(kind==='avatar'){const baby=await c.env.DB.prepare('SELECT avatar_key FROM babies WHERE id=?').bind(id).first<{avatar_key:string}>();key=baby?.avatar_key}
 else{const media=await c.env.DB.prepare('SELECT * FROM media WHERE id=? AND purge_token IS NULL').bind(id).first<{object_key:string;thumbnail_ready:number;thumbnail_object_key?:string}>();if(media)key=kind==='original'?media.object_key:media.thumbnail_object_key|| (media.thumbnail_ready?thumbKey(id):undefined)}
 if(!key)return fail(c,404,'EXPORT_OBJECT_UNAVAILABLE');
 const object=await c.env.MEDIA.get(key);if(!object)return fail(c,404,'EXPORT_OBJECT_UNAVAILABLE');
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
});
app.get('/api/export/full',async c=>{
 try{return new Response(await completeFamilyExport(c.env),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="babymemo-family-'+now().slice(0,10)+'.zip"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
 catch{return fail(c,409,'EXPORT_OBJECT_UNAVAILABLE')}
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
app.post('/api/settings/ai',async c=>{
  try{
    const v=await json(c.req.raw);
    if(v.provider!=='workers-ai'&&v.provider!=='openrouter')return fail(c,400,'INVALID_AI_PROVIDER');
    if(v.provider==='openrouter'&&!deployedOpenRouterKey(c.env)&&!await setting(c.env,'openrouter_key'))
      return fail(c,409,'OPENROUTER_NOT_CONFIGURED');
    if(v.provider==='workers-ai'&&!c.env.AI)return fail(c,503,'WORKERS_AI_BINDING_MISSING');
    await setSetting(c.env,'ai_provider',v.provider);
    return c.json({ok:true,provider:v.provider});
  }catch{return fail(c,400,'AI_PROVIDER_SAVE_FAILED');}
});
app.post('/api/settings/ai/test',async c=>{
  try{
    const provider=await setting(c.env,'ai_provider')||DEFAULT_AI_PROVIDER;
    const ok=provider==='openrouter'?await testOpenRouterConnection(c.env):await testWorkersAIConnection(c.env);
    return c.json({ok,provider});
  }catch(e){return fail(c,502,e instanceof Error?e.message:'AI_MODEL_FAILED');}
});
app.post('/api/settings/openrouter',async c=>{
  try{
    const v=await json(c.req.raw);
    if(typeof v.model!=='string'||!/^[\w./:-]{3,100}$/.test(v.model))return fail(c,400,'INVALID_MODEL');
    if(v.apiKey!==undefined){
      if(deployedOpenRouterKey(c.env))return fail(c,409,'OPENROUTER_MANAGED_BY_DEPLOYMENT');
      if(typeof v.apiKey!=='string'||!v.apiKey.startsWith('sk-or-')||v.apiKey.length>300)return fail(c,400,'INVALID_API_KEY');
      await setSetting(c.env,'openrouter_key',await encryptSecret(c.env,v.apiKey));
    }
    await setSetting(c.env,'openrouter_model',v.model);
    return c.json({ok:true});
  }catch{return fail(c,400,'DATA_KEY_OR_SETTINGS_ERROR');}
});
app.post('/api/settings/openrouter/test',async c=>{
  try{const ok=await testOpenRouterConnection(c.env);return c.json({ok});}
  catch(e){return fail(c,502,e instanceof Error?e.message:'OPENROUTER_FAILED');}
});
// Pending QR codes are scoped to one pairing ID, so two family members may
// scan concurrently without racing on the previous global pairing setting.
app.post('/api/settings/wechat/qr',async c=>{
  try{
    const v=await json(c.req.raw);
    const label=typeof v.label==='string'?v.label.trim():'';
    if(!label||label.length>40)return fail(c,400,'INVALID_WECHAT_MEMBER_NAME');
    const info=await generateQr();
    const id=crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO wechat_pairings(id,label,qr_cipher,base_url,expires_at) VALUES(?,?,?,?,?)')
      .bind(id,label,await encryptSecret(c.env,info.code),'https://ilinkai.weixin.qq.com',Date.now()+10*60_000).run();
    return c.json({pairingId:id,qrContent:info.content});
  }catch{return fail(c,502,'WECHAT_QR_FAILED');}
});
app.post('/api/settings/wechat/qr/status',async c=>{
  try{
    const v=await json(c.req.raw);
    if(typeof v.pairingId!=='string'||!/^[0-9a-f-]{36}$/.test(v.pairingId))return fail(c,400,'PAIRING_NOT_STARTED');
    const pairing=await c.env.DB.prepare('SELECT id,label,qr_cipher,base_url,expires_at FROM wechat_pairings WHERE id=?')
      .bind(v.pairingId).first<{id:string;label:string;qr_cipher:string;base_url:string;expires_at:number}>();
    if(!pairing)return fail(c,404,'PAIRING_NOT_FOUND');
    if(pairing.expires_at<Date.now()){
      await c.env.DB.prepare('DELETE FROM wechat_pairings WHERE id=?').bind(pairing.id).run();
      return c.json({status:'expired'});
    }
    const result=await qrStatus(await decryptSecret(c.env,pairing.qr_cipher),
      typeof v.verifyCode==='string'?v.verifyCode.slice(0,32):undefined,pairing.base_url);
    if(result.redirectBase)await c.env.DB.prepare('UPDATE wechat_pairings SET base_url=? WHERE id=?')
      .bind(result.redirectBase,pairing.id).run();
    if(result.status==='confirmed'){
      if(!result.botToken||!result.botId||!result.userId)return fail(c,502,'INVALID_WECHAT_CREDENTIALS');
      const existing=await c.env.DB.prepare('SELECT id FROM wechat_connections WHERE bot_id=? OR user_id=? LIMIT 1')
        .bind(result.botId,result.userId).first<{id:string}>();
      const id=existing?.id||crypto.randomUUID();
      if(existing){
        // Stop polling before replacing credentials; never inherit old cursors.
        await workerBot(c.env,id).fetch('https://bot.internal/pause',{method:'POST'});
        await c.env.DB.prepare('UPDATE wechat_connections SET bot_id=?,user_id=?,token_cipher=?,base_url=?,enabled=0,updated_at=? WHERE id=?')
          .bind(result.botId,result.userId,await encryptSecret(c.env,result.botToken),result.base||pairing.base_url,now(),id).run();
      }else{
        await c.env.DB.prepare('INSERT INTO wechat_connections(id,label,bot_id,user_id,token_cipher,base_url,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)')
          .bind(id,pairing.label,result.botId,result.userId,await encryptSecret(c.env,result.botToken),result.base||pairing.base_url,now(),now()).run();
      }
      const reset=await workerBot(c.env,id).fetch('https://bot.internal/reset?connectionId='+encodeURIComponent(id),{method:'POST'});
      if(!reset.ok)throw Error('WECHAT_RESET_FAILED');
      await c.env.DB.prepare('DELETE FROM wechat_pairings WHERE id=?').bind(pairing.id).run();
      return c.json({status:'confirmed',connectionId:id});
    }
    return c.json({status:result.status});
  }catch{return fail(c,502,'WECHAT_PAIRING_FAILED');}
});
app.patch('/api/settings/wechat/connections/:id',async c=>{
  const connection=await getWechatConnection(c.env,c.req.param('id'));
  if(!connection)return fail(c,404,'WECHAT_CONNECTION_NOT_FOUND');
  try{
    const v=await json(c.req.raw);
    if(typeof v.label!=='string'||!v.label.trim()||v.label.trim().length>40)return fail(c,400,'INVALID_WECHAT_MEMBER_NAME');
    await c.env.DB.prepare('UPDATE wechat_connections SET label=?,updated_at=? WHERE id=?').bind(v.label.trim(),now(),connection.id).run();
    return c.json({ok:true});
  }catch{return fail(c,400,'INVALID_WECHAT_MEMBER_NAME');}
});
app.post('/api/settings/wechat/connections/:id/:action',async c=>{
  const {id,action}=c.req.param();
  if(action!=='start'&&action!=='pause')return fail(c,404,'NOT_FOUND');
  const connection=await getWechatConnection(c.env,id);
  if(!connection)return fail(c,404,'WECHAT_CONNECTION_NOT_FOUND');
  if(action==='start'&&(await setting(c.env,'ai_provider')||DEFAULT_AI_PROVIDER)==='openrouter'&&!deployedOpenRouterKey(c.env)&&!await setting(c.env,'openrouter_key'))return fail(c,409,'OPENROUTER_NOT_CONFIGURED');
  const enabled=action==='start'?1:0;
  await c.env.DB.prepare('UPDATE wechat_connections SET enabled=?,updated_at=? WHERE id=?').bind(enabled,now(),id).run();
  const response=await workerBot(c.env,id).fetch('https://bot.internal/'+action,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({connectionId:id})});
  if(!response.ok){
    if(action==='start')await c.env.DB.prepare('UPDATE wechat_connections SET enabled=0,updated_at=? WHERE id=?').bind(now(),id).run();
    return fail(c,502,'WECHAT_BOT_UPDATE_FAILED');
  }
  return c.json({ok:true,status:action});
});
app.get('/api/settings/wechat/connections/:id/status',async c=>{
  const id=c.req.param('id');
  if(!await getWechatConnection(c.env,id))return fail(c,404,'WECHAT_CONNECTION_NOT_FOUND');
  const response=await workerBot(c.env,id).fetch('https://bot.internal/status?connectionId='+encodeURIComponent(id));
  return c.json(await response.json());
});
app.delete('/api/settings/wechat/connections/:id',async c=>{
  const id=c.req.param('id');
  if(!await getWechatConnection(c.env,id))return fail(c,404,'WECHAT_CONNECTION_NOT_FOUND');
  await c.env.DB.prepare('UPDATE wechat_connections SET enabled=0,updated_at=? WHERE id=?').bind(now(),id).run();
  const response=await workerBot(c.env,id).fetch('https://bot.internal/reset?connectionId='+encodeURIComponent(id),{method:'POST'});
  if(!response.ok)return fail(c,502,'WECHAT_BOT_UPDATE_FAILED');
  await c.env.DB.prepare('DELETE FROM wechat_connections WHERE id=?').bind(id).run();
  return c.json({ok:true});
});
// The default target is used only for image-only WeChat messages in multi-baby families.
app.post('/api/settings/wechat/default-baby',async c=>{
  try{
    const v=await json(c.req.raw);
    if(typeof v.babyId!=='string')return fail(c,400,'INVALID_BABY');
    if(v.babyId&&!await babyExists(c.env,v.babyId))return fail(c,404,'INVALID_BABY');
    await setSetting(c.env,'wechat_default_baby_id',v.babyId);
    return c.json({ok:true,defaultBabyId:v.babyId});
  }catch{return fail(c,400,'INVALID_BABY')}
});
app.route('/api',webManagement);
app.onError((e,c)=>{
  console.error(JSON.stringify({level:'error',code:'UNHANDLED_REQUEST',path:c.req.path})); 
  return fail(c,500,'INTERNAL_ERROR');
});
export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){
    ctx.waitUntil(env.DB.prepare("DELETE FROM wechat_messages WHERE state='done' AND created_at<?").bind(new Date(Date.now()-90*86400000).toISOString()).run()
      .catch(()=>console.error(JSON.stringify({level:'error',event:'BOT_DEDUP_RETENTION_FAILED'}))));
    ctx.waitUntil(env.DB.prepare('DELETE FROM wechat_agent_rounds WHERE created_at<?').bind(new Date(Date.now()-90*86400000).toISOString()).run()
      .catch(()=>console.error(JSON.stringify({level:'error',event:'AGENT_ROUND_RETENTION_FAILED'}))));
    ctx.waitUntil(env.DB.prepare('DELETE FROM wechat_pairings WHERE expires_at<?').bind(Date.now()).run()
      .catch(()=>console.error(JSON.stringify({level:'error',event:'PAIRING_RETENTION_FAILED'}))));
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
  await purgeDeletedMedia(env);
  for(const table of ['growth_records','milestones']){
    await env.DB.prepare('DELETE FROM '+table+' WHERE deleted_at IS NOT NULL AND deleted_at<?').bind(cutoff).run();
  }
}
