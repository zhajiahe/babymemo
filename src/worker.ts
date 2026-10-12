import { Hono } from 'hono';
import type { Env, Baby } from './types';
import { applySession, authenticated, clearSession, login, owner, sameOrigin, setup } from './auth';
import { decryptSecret, encryptSecret, setSetting, setting } from './crypto';
import { generateQr, qrStatus, askOpenRouter, workerBot } from './wechat';
export { WechatSession } from './wechat';

const app = new Hono<{Bindings:Env}>();
const fail = (c: any, status:number, error:string) => c.json({error},status);
const json = async (req: Request, limit=16_384):Promise<any> => {
  if(Number(req.headers.get('content-length'))>limit)throw Error('BODY_TOO_LARGE');
  const raw=await req.text();
  if(raw.length>limit)throw Error('BODY_TOO_LARGE');
  return JSON.parse(raw);
};
const dayOk = (s:unknown):s is string => typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
const validNum=(v:unknown,min:number,max:number):boolean=>v===null||v===undefined||(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max);
const now=()=>new Date().toISOString();
const allowedMime=(s:string)=>/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm))$/.test(s);
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
app.get('/api/health',c=>c.json({ok:true,service:'babymemo',version:1}));
app.get('/api/bootstrap/status',async c=>c.json({
  initialized:!!await owner(c.env),
  bootstrapConfigured:!!c.env.BOOTSTRAP_SECRET&&c.env.BOOTSTRAP_SECRET.length>=32,
  sessionConfigured:!!c.env.SESSION_SECRET&&c.env.SESSION_SECRET.length>=32,
  encryptionConfigured:!!c.env.DATA_KEY&&/^[a-f0-9]{64}$/i.test(c.env.DATA_KEY)
}));
app.post('/api/bootstrap',async c=>{
  try {
    const v=await json(c.req.raw);
    const id=await setup(c,{bootstrapSecret:String(v.bootstrapSecret??''),ownerName:String(v.ownerName??''),familyName:String(v.familyName??''),password:String(v.password??''),babyName:String(v.babyName??''),birthday:String(v.birthday??''),gender:String(v.gender??''),timeZone:String(v.timeZone??'Asia/Shanghai'),allergies:String(v.allergies??'')});
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
  const [user,babies,growth,milestones,media]=await Promise.all([
    owner(c.env),
    c.env.DB.prepare('SELECT id,name,birthday,gender,time_zone,allergies,notes FROM babies ORDER BY created_at').all(),
    c.env.DB.prepare('SELECT count(*) AS count FROM growth_records').first<{count:number}>(),
    c.env.DB.prepare('SELECT count(*) AS count FROM milestones').first<{count:number}>(),
    c.env.DB.prepare('SELECT count(*) AS count FROM media').first<{count:number}>()
  ]);
  const [encryptedApiKey,encryptedBot,model,botOn,familyName] = await Promise.all([
    setting(c.env,'openrouter_key'),setting(c.env,'wechat_token'),setting(c.env,'openrouter_model'),setting(c.env,'wechat_enabled'),setting(c.env,'family_name')
  ]);
  return c.json({ownerName:user!.name,familyName:familyName||'家庭空间',babies:babies.results,counts:{growth:growth?.count??0,milestones:milestones?.count??0,media:media?.count??0},
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
  const r=await c.env.DB.prepare('SELECT * FROM '+table+' WHERE baby_id=? ORDER BY day DESC,created_at DESC LIMIT 40 OFFSET ?').bind(babyId,page*40).all();
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
  await c.env.DB.prepare('DELETE FROM '+table+' WHERE id=?').bind(c.req.param('id')).run();
  return c.json({ok:true});
});
app.get('/api/media',async c=>{
  const babyId=c.req.query('babyId');if(!babyId||!await babyExists(c.env,babyId))return fail(c,400,'INVALID_BABY');
  const page=Math.min(1000,Math.max(0,Number.parseInt(c.req.query('page')||'0',10)||0));
  const rows=await c.env.DB.prepare('SELECT id,baby_id,day,title,mime,size,created_at FROM media WHERE baby_id=? ORDER BY day DESC,created_at DESC LIMIT 36 OFFSET ?').bind(babyId,page*36).all();
  return c.json({items:rows.results,hasMore:rows.results.length===36});
});
app.post('/api/upload/start',async c=>{
  try{
    const v=await json(c.req.raw);
    if(typeof v.babyId!=='string'||!await babyExists(c.env,v.babyId)||!dayOk(v.day)||typeof v.mime!=='string'||!allowedMime(v.mime)||!Number.isSafeInteger(v.size)||v.size<1||v.size>209715200)return fail(c,400,'INVALID_MEDIA');
    const id=crypto.randomUUID(),key='private/'+v.babyId+'/'+id;
    const handle=await c.env.MEDIA.createMultipartUpload(key,{httpMetadata:{contentType:v.mime}});
    await c.env.DB.prepare('INSERT INTO media_uploads(id,baby_id,object_key,upload_id,day,title,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,v.babyId,key,handle.uploadId,v.day,String(v.title||'').slice(0,120),v.mime,v.size,now()).run();
    return c.json({id,chunkSize:8388608},201);
  }catch{return fail(c,400,'UPLOAD_START_FAILED');}
});
app.put('/api/upload/:id/part/:number',async c=>{
  const id=c.req.param('id'),number=Number(c.req.param('number'));
  if(!Number.isInteger(number)||number<1||number>30)return fail(c,400,'INVALID_PART');
  const row=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first<{object_key:string;upload_id:string;size:number}>();
  if(!row)return fail(c,404,'UPLOAD_NOT_FOUND');
  const length=Number(c.req.header('content-length'));
  if(!Number.isFinite(length)||length<=0||length>8388608)return fail(c,413,'INVALID_PART_SIZE');
  try{
    const part=await c.env.MEDIA.resumeMultipartUpload(row.object_key,row.upload_id).uploadPart(number,c.req.raw.body!);
    await c.env.DB.prepare('INSERT INTO media_upload_parts(media_upload_id,part_number,etag) VALUES(?,?,?) ON CONFLICT(media_upload_id,part_number) DO UPDATE SET etag=excluded.etag').bind(id,number,part.etag).run();
    return c.json({ok:true,partNumber:number});
  }catch{return fail(c,502,'UPLOAD_PART_FAILED');}
});
app.post('/api/upload/:id/finish',async c=>{
  const id=c.req.param('id');
  const row=await c.env.DB.prepare('SELECT * FROM media_uploads WHERE id=?').bind(id).first<{object_key:string;upload_id:string;size:number;baby_id:string;day:string;title:string;mime:string}>();
  if(!row)return fail(c,404,'UPLOAD_NOT_FOUND');
  const parts=await c.env.DB.prepare('SELECT part_number AS partNumber,etag FROM media_upload_parts WHERE media_upload_id=? ORDER BY part_number').bind(id).all<{partNumber:number;etag:string}>();
  const expected=Math.ceil(row.size/8388608);
  if(parts.results.length!==expected||parts.results.some((p,i)=>p.partNumber!==i+1))return fail(c,400,'UPLOAD_INCOMPLETE');
  try {
    await c.env.MEDIA.resumeMultipartUpload(row.object_key,row.upload_id).complete(parts.results);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO media(id,baby_id,day,title,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,row.baby_id,row.day,row.title,row.object_key,row.mime,row.size,now()),
      c.env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(id)
    ]);
    return c.json({id},201);
  }catch{return fail(c,502,'UPLOAD_FINISH_FAILED');}
});
app.get('/api/media/:id/content',async c=>{
  const row=await c.env.DB.prepare('SELECT object_key,mime FROM media WHERE id=?').bind(c.req.param('id')).first<{object_key:string;mime:string}>();
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
  const row=await c.env.DB.prepare('SELECT object_key FROM media WHERE id=?').bind(c.req.param('id')).first<{object_key:string}>();
  if(!row)return fail(c,404,'NOT_FOUND');
  await c.env.MEDIA.delete(row.object_key);
  await c.env.DB.prepare('DELETE FROM media WHERE id=?').bind(c.req.param('id')).run();
  return c.json({ok:true});
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
    const baby=await currentBaby(c.env);const answer=await askOpenRouter(c.env,v.message,baby);
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
  return c.json({ok:result.ok,status:action});
});
app.get('/api/settings/wechat/status',async c=>{
  const response=await workerBot(c.env).fetch('https://bot.internal/status');
  return c.json(await response.json());
});
app.onError((e,c)=>{
  console.error(JSON.stringify({level:'error',code:'UNHANDLED_REQUEST',path:c.req.path})); 
  return fail(c,500,'INTERNAL_ERROR');
});
export default app;
