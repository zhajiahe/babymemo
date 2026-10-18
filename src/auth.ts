import type { Context } from 'hono';
import type { Env, Owner,ApplicationEnv } from './types';
import {validCalendarDay,validTimeZone} from './validation';
import { constantEqual, passwordHash, randomHex, SESSION_LIFETIME_MS, SESSION_MAX_AGE_SECONDS, SESSION_RENEW_AFTER_MS, sessionExpiry, signSession } from './crypto';
type Ctx=Context<ApplicationEnv>;
export async function owner(env:Env):Promise<Owner|null> {
  return (await env.DB.prepare('SELECT * FROM owner WHERE id=1').first<Owner>())??null;
}
export async function authenticated(c:Ctx):Promise<boolean>{
  const user=await owner(c.env);
  if(!user||!c.env.SESSION_SECRET)return false;
  const cookie=c.req.header('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('babymemo_session='))?.slice('babymemo_session='.length)??'';
  const expiresAt=await sessionExpiry(cookie,c.env.SESSION_SECRET,user.session_version);
  if(expiresAt===null)return false;
  // The app always requests /api/state when opened. Upgrade existing 7-day
  // cookies on that request, then extend a long session at most once per 30 days.
  // Only renew here: logout and password changes must be able to clear the cookie.
  if(c.req.method==='GET'&&c.req.path==='/api/state'&&
    expiresAt-Date.now()<=SESSION_LIFETIME_MS-SESSION_RENEW_AFTER_MS){
    await applySession(c,user.session_version);
  }
  return true;
}
export async function login(c:Ctx,password:string):Promise<boolean>{
  const ip=c.req.header('CF-Connecting-IP')??'unknown';
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
  const key=Array.from(new Uint8Array(raw),b=>b.toString(16).padStart(2,'0')).join('');
  const now=Date.now(),until=now+900000;
  await c.env.DB.prepare("INSERT INTO auth_attempts(ip_hash,tries,expires_at) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET tries=CASE WHEN expires_at < ? THEN 1 ELSE tries+1 END,expires_at=CASE WHEN expires_at < ? THEN ? ELSE expires_at END").bind(key,until,now,now,until).run();
  const row=await c.env.DB.prepare('SELECT tries FROM auth_attempts WHERE ip_hash=?').bind(key).first<{tries:number}>();
  if((row?.tries??99)>5)return false;
  const existing=await owner(c.env);
  if(!existing)return false;
  const hash=await passwordHash(password,existing.password_salt);
  if(!constantEqual(existing.password_hash,hash))return false;
  await c.env.DB.prepare('DELETE FROM auth_attempts WHERE ip_hash=?').bind(key).run();
  await applySession(c,existing.session_version);
  return true;
}
export async function applySession(c:Ctx,version:number):Promise<void>{
  if(!c.env.SESSION_SECRET||c.env.SESSION_SECRET.length<32)throw Error('SESSION_SECRET_NOT_CONFIGURED');
  const token=await signSession(c.env.SESSION_SECRET,version);
  c.header('Set-Cookie','babymemo_session='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+SESSION_MAX_AGE_SECONDS);
}
export function clearSession(c:Ctx):void{
  c.header('Set-Cookie','babymemo_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}
export async function setup(c:Ctx,input:{ownerName:string;familyName:string;password:string;babyName:string;birthday:string;birthTime:string;gender:string;timeZone:string;allergies:string}):Promise<string>{
  if(await owner(c.env))throw Error('ALREADY_INITIALIZED');
  if(!c.env.SESSION_SECRET||c.env.SESSION_SECRET.length<32)throw Error('SESSION_SECRET_NOT_CONFIGURED');
  if(!c.env.DATA_KEY||!/^[a-f0-9]{64}$/i.test(c.env.DATA_KEY))throw Error('DATA_KEY_NOT_CONFIGURED');
  if(input.password.length<6||input.password.length>128||!input.familyName.trim()||input.familyName.trim().length>80||!input.ownerName.trim()||input.ownerName.length>80||input.babyName.length<1||input.babyName.length>80||!validCalendarDay(input.birthday)||!['boy','girl','other'].includes(input.gender))throw Error('INVALID_SETUP_INPUT');
  if(!validTimeZone(input.timeZone))throw Error('INVALID_TIME_ZONE');
  if(input.birthTime!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.birthTime))throw Error('INVALID_BIRTH_TIME');
  const salt=randomHex(16),hash=await passwordHash(input.password,salt),id=crypto.randomUUID(),when=new Date().toISOString();
  // Atomic DB.batch + owner(id=1) prevent concurrent first-run takeovers.
  try{await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO owner(id,name,password_salt,password_hash,session_version,created_at) VALUES(1,?,?,?,1,?)').bind(input.ownerName.trim(),salt,hash,when),
    c.env.DB.prepare("INSERT INTO app_settings(name,value,updated_at) VALUES('family_name',?,?)").bind(input.familyName.trim(),when),
    c.env.DB.prepare('INSERT INTO babies(id,name,birthday,birth_time,gender,time_zone,allergies,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,input.babyName,input.birthday,input.birthTime,input.gender,input.timeZone,input.allergies.slice(0,2000),'',when)
  ]);}catch(e){if(await owner(c.env))throw Error('ALREADY_INITIALIZED');throw e;}
  await applySession(c,1);
  return id;
}
export function sameOrigin(c:Ctx):boolean {
  const origin=c.req.header('Origin');
  if(!origin)return false;
  try{return new URL(origin).origin===new URL(c.req.url).origin;}catch{return false;}
}
