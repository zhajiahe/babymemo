import type { Env } from './types';
const encoder = new TextEncoder();
export function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes, b=>b.toString(16).padStart(2,'0')).join('');
}
export function randomHex(length = 32): string {
  return bytesHex(crypto.getRandomValues(new Uint8Array(length)));
}
export function constantEqual(a: string, b: string): boolean {
  const length = Math.max(a.length,b.length);
  let diff = a.length ^ b.length;
  for(let i=0;i<length;i++) diff |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return diff === 0;
}
export async function passwordHash(password:string, salt:string):Promise<string> {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  // Cloudflare Workers SubtleCrypto allows at most 100,000 PBKDF2 iterations.
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
  return bytesHex(new Uint8Array(bits));
}
function base64url(data: Uint8Array): string {
  let binary='';
  for(const byte of data) binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unbase64url(data: string): Uint8Array {
  const str=atob(data.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-data.length%4)%4));
  return Uint8Array.from(str,c=>c.charCodeAt(0));
}
async function hmac(secret:string,payload:string):Promise<string> {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(payload))));
}
// A signed, first-party cookie keeps a family signed in across browser restarts.
// Renew after 30 days of use; old 7-day cookies remain valid until they expire.
export const SESSION_MAX_AGE_SECONDS = 180*24*60*60;
export const SESSION_LIFETIME_MS = SESSION_MAX_AGE_SECONDS*1000;
export const SESSION_RENEW_AFTER_MS = 30*24*60*60*1000;

export async function signSession(secret:string,version:number):Promise<string> {
  const data=base64url(encoder.encode(JSON.stringify({v:version,exp:Date.now()+SESSION_LIFETIME_MS,n:randomHex(12)})));
  return data+'.'+await hmac(secret,data);
}

export async function sessionExpiry(token:string,secret:string,version:number):Promise<number|null> {
  if(!token||!secret||token.length>1024)return null;
  const parts=token.split('.');
  if(parts.length!==2 || !constantEqual(parts[1],await hmac(secret,parts[0])))return null;
  try {
    const info=JSON.parse(new TextDecoder().decode(unbase64url(parts[0])));
    const now=Date.now();
    // Bound accepted expiration: a valid signature must not grant an unbounded session.
    return info.v===version&&typeof info.exp==='number'&&
      info.exp>now&&info.exp<=now+SESSION_LIFETIME_MS+60_000?info.exp:null;
  }catch{return null;}
}

export async function verifySession(token:string,secret:string,version:number):Promise<boolean> {
  return (await sessionExpiry(token,secret,version))!==null;
}
async function dataKey(env:Env):Promise<CryptoKey> {
  if(!env.DATA_KEY||!/^[a-fA-F0-9]{64}$/.test(env.DATA_KEY))throw Error('DATA_KEY_NOT_CONFIGURED');
  const bytes=Uint8Array.from(env.DATA_KEY.match(/../g)!,h=>parseInt(h,16));
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptSecret(env:Env,value:string):Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await dataKey(env),encoder.encode(value)));
  return 'v1:'+base64url(iv)+':'+base64url(data);
}
export async function decryptSecret(env:Env,value:string):Promise<string> {
  const parts=value.split(':');
  if(parts.length!==3||parts[0]!=='v1')throw Error('INVALID_ENCRYPTED_SECRET');
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(unbase64url(parts[1]))},await dataKey(env),new Uint8Array(unbase64url(parts[2])));
  return new TextDecoder().decode(data);
}
// A deployment-managed key is authoritative; never serialize its value to D1 or the browser.
export function deployedOpenRouterKey(env:Env):string|null {
  return typeof env.OPENROUTER_API_KEY==='string'&&env.OPENROUTER_API_KEY.trim()?env.OPENROUTER_API_KEY.trim():null;
}
export async function resolveOpenRouterKey(env:Env):Promise<string|null> {
  const configured=deployedOpenRouterKey(env);
  if(configured)return configured;
  const encrypted=await setting(env,'openrouter_key');
  return encrypted?decryptSecret(env,encrypted):null;
}
export async function setting(env:Env,name:string):Promise<string|null> {
  const row=await env.DB.prepare('SELECT value FROM app_settings WHERE name=?').bind(name).first<{value:string}>();
  return row?.value??null;
}
export async function setSetting(env:Env,name:string,value:string):Promise<void> {
  await env.DB.prepare('INSERT INTO app_settings(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(name,value,new Date().toISOString()).run();
}
