import {Hono} from 'hono';
import type {Context} from 'hono';
import type {ApplicationEnv,Env} from './types';
import {authenticated,owner} from './auth';
import {constantEqual,randomHex} from './crypto';
import {setting} from './crypto';

type Ctx=Context<ApplicationEnv>;
type PairRow={id:string;code:string;verifier_hash:string;expires_at:number;approved:number;claimed:number};
const WINDOW_MS=10*60*1000;
const TV_MAX_AGE=90*24*60*60;
const PAIR_START='/api/tv/pair/start';
const PAIR_POLL='/api/tv/pair/poll';
const toHex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
const digest=async(value:string)=>toHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));

export function tvPublicRequest(path:string,method:string):boolean {
  return method==='POST'&&(path===PAIR_START||path===PAIR_POLL);
}
// No write access, export, settings, or raw owner state through a TV cookie.
export function tvReadRequest(path:string,method:string):boolean {
  return method==='GET'&&(
    path==='/api/tv/catalog'||path==='/api/media'||path==='/api/media/revision'||
    /^\/api\/media\/[0-9a-f-]{36}\/(?:thumbnail|content)$/i.test(path)
  );
}
export async function authorizedTv(c:Ctx):Promise<boolean>{
  if(!tvReadRequest(c.req.path,c.req.method))return false;
  const raw=c.req.header('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('babymemo_tv='))?.slice('babymemo_tv='.length)||'';
  const match=/^([0-9a-f-]{36})\.([a-f0-9]{64})$/i.exec(raw);
  if(!match)return false;
  const row=await c.env.DB.prepare('SELECT token_hash,session_version,created_at,revoked_at FROM tv_devices WHERE id=?')
    .bind(match[1]).first<{token_hash:string;session_version:number;created_at:number;revoked_at:number|null}>();
  if(!row||row.revoked_at!==null||Date.now()-row.created_at>TV_MAX_AGE*1000)return false;
  const user=await owner(c.env);
  if(!user||row.session_version!==user.session_version)return false;
  return constantEqual(row.token_hash,await digest(match[2]));
}
function setTvCookie(c:Ctx,id:string,token:string):void {
  c.header('Set-Cookie','babymemo_tv='+id+'.'+token+'; Path=/api; Max-Age='+TV_MAX_AGE+'; HttpOnly; Secure; SameSite=Lax');
}
async function requireOwner(c:Ctx):Promise<boolean>{return authenticated(c)}

export const tvRoutes=new Hono<ApplicationEnv>();
tvRoutes.post('/pair/start',async c=>{
  const ip=c.req.header('CF-Connecting-IP')||'unknown';
  const hash=await digest('tv-pair:'+ip);
  const now=Date.now();
  await c.env.DB.prepare('INSERT INTO tv_pair_attempts(ip_hash,tries,expires_at) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET tries=CASE WHEN expires_at<? THEN 1 ELSE tries+1 END,expires_at=CASE WHEN expires_at<? THEN ? ELSE expires_at END')
    .bind(hash,now+WINDOW_MS,now,now,now+WINDOW_MS).run();
  const attempts=await c.env.DB.prepare('SELECT tries FROM tv_pair_attempts WHERE ip_hash=?').bind(hash).first<{tries:number}>();
  if((attempts?.tries||0)>10)return c.json({error:'PAIR_RATE_LIMIT'},429);
  const id=crypto.randomUUID(),verifier=randomHex(32),code=randomHex(5).toUpperCase(),expiresAt=now+WINDOW_MS;
  await c.env.DB.prepare('INSERT INTO tv_pair_requests(id,code,verifier_hash,expires_at) VALUES(?,?,?,?)')
    .bind(id,code,await digest(verifier),expiresAt).run();
  return c.json({id,verifier,code,expiresAt});
});

tvRoutes.post('/pair/poll',async c=>{
  let input:unknown;
  try{input=await c.req.json()}catch{return c.json({error:'INVALID_INPUT'},400)}
  const v=input as {id?:unknown;verifier?:unknown};
  if(typeof v?.id!=='string'||!/^[0-9a-f-]{36}$/i.test(v.id)||typeof v.verifier!=='string'||!/^[a-f0-9]{64}$/i.test(v.verifier))return c.json({error:'INVALID_INPUT'},400);
  const row=await c.env.DB.prepare('SELECT * FROM tv_pair_requests WHERE id=?').bind(v.id).first<PairRow>();
  if(!row||row.expires_at<=Date.now()||!constantEqual(row.verifier_hash,await digest(v.verifier)))return c.json({error:'PAIR_EXPIRED'},410);
  if(!row.approved)return c.json({status:'pending'});
  if(row.claimed)return c.json({error:'PAIR_ALREADY_USED'},410);
  const claimed=await c.env.DB.prepare('UPDATE tv_pair_requests SET claimed=1 WHERE id=? AND approved=1 AND claimed=0 AND expires_at>?').bind(row.id,Date.now()).run();
  if(!claimed.meta.changes)return c.json({error:'PAIR_ALREADY_USED'},410);
  const user=await owner(c.env);
  if(!user)return c.json({error:'NOT_INITIALIZED'},503);
  const id=crypto.randomUUID(),token=randomHex(32);
  await c.env.DB.prepare('INSERT INTO tv_devices(id,token_hash,session_version,created_at) VALUES(?,?,?,?)')
    .bind(id,await digest(token),user.session_version,Date.now()).run();
  setTvCookie(c,id,token);
  return c.json({status:'approved'});
});

tvRoutes.post('/pair/approve',async c=>{
  if(!await requireOwner(c))return c.json({error:'LOGIN_REQUIRED'},401);
  let data:unknown;
  try{data=await c.req.json()}catch{return c.json({error:'INVALID_INPUT'},400)}
  const code=(data as {code?:unknown})?.code;
  if(typeof code!=='string'||!/^[A-F0-9]{10}$/.test(code))return c.json({error:'INVALID_CODE'},400);
  const result=await c.env.DB.prepare('UPDATE tv_pair_requests SET approved=1 WHERE code=? AND approved=0 AND claimed=0 AND expires_at>?')
    .bind(code,Date.now()).run();
  return result.meta.changes?c.json({ok:true}):c.json({error:'PAIR_NOT_FOUND_OR_EXPIRED'},404);
});

tvRoutes.get('/catalog',async c=>{
  const babies=await c.env.DB.prepare('SELECT id,name,birthday FROM babies WHERE archived_at IS NULL ORDER BY created_at').all<{id:string;name:string;birthday:string}>();
  return c.json({familyName:await setting(c.env,'family_name')||'家庭空间',babies:babies.results});
});

tvRoutes.get('/devices',async c=>{
  if(!await requireOwner(c))return c.json({error:'LOGIN_REQUIRED'},401);
  const devices=await c.env.DB.prepare('SELECT id,created_at,revoked_at FROM tv_devices ORDER BY created_at DESC LIMIT 50')
    .all<{id:string;created_at:number;revoked_at:number|null}>();
  return c.json({items:devices.results});
});
tvRoutes.post('/devices/:id/revoke',async c=>{
  if(!await requireOwner(c))return c.json({error:'LOGIN_REQUIRED'},401);
  const id=c.req.param('id');
  if(!/^[0-9a-f-]{36}$/i.test(id))return c.json({error:'INVALID_ID'},400);
  await c.env.DB.prepare('UPDATE tv_devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),id).run();
  return c.json({ok:true});
});
