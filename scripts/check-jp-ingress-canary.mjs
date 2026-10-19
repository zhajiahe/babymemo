#!/usr/bin/env node
// Strictly read-only, unauthenticated smoke tests of public JP-1 ingress.
// Runs on a GitHub-hosted runner (NOT representative of mainland latency).
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';

const host='bm-jp-canary.20250530.space';
const current='baby.20250530.space';
const ip='172.64.229.191';
const rows=[];
const timeout=12000;
async function request(hostname,path,options={}){
 const at=performance.now();
 const response=await fetch('https://'+hostname+path,{
   cache:'no-store',redirect:'manual',
   ...options,signal:AbortSignal.timeout(timeout)
 });
 const body=await response.text();
 return {
   status:response.status,ms:Math.round(performance.now()-at),body,
   contentType:response.headers.get('content-type')||'',
   setCookie:response.headers.get('set-cookie')||'',
   cacheControl:response.headers.get('cache-control')||'',
   ray:response.headers.get('cf-ray')||'',
   final:response.url
 };
}
function record(name,ok,details={}){
 rows.push({name,ok,...details});
 console.log(JSON.stringify({name,ok,...details}));
}
let failed=false;
function check(name,condition,details={}){record(name,condition,details);if(!condition)failed=true}

try{
 const resolved=await dns.resolve4(host);
 check('fixed-jp-ip',resolved.includes(ip),{resolved});
}catch(e){check('fixed-jp-ip',false,{error:e.code||e.name})}

for(const hostname of [current,host]){
 const tag=hostname===current?'production':'canary';
 try{
  const response=await request(hostname,'/api/health?probe=jp-migration');
  let health=null;try{health=JSON.parse(response.body)}catch{}
  check(tag+'-health',response.status===200&&health?.ok===true&&health?.service==='babymemo',{
   status:response.status,ms:response.ms,colo:response.ray.slice(-3)});
 }catch(e){check(tag+'-health',false,{error:e.name||'unknown'})}
}
try{
 const trace=await request(host,'/cdn-cgi/trace');
 const colo=trace.body.match(/^colo=([A-Z]{3})$/m)?.[1]||null;
 check('canary-cloudflare-colo',trace.status===200&&!!colo,{status:trace.status,colo});
}catch(e){check('canary-cloudflare-colo',false,{error:e.name||'unknown'})}
try{
 const index=await request(host,'/');
 const valid=index.status===200&&/text\/html/i.test(index.contentType)&&/<html/i.test(index.body);
 check('canary-application-html',valid,{
  status:index.status,contentType:index.contentType,bytes:index.body.length});
 if(valid){
  // Check hashed Vite assets are served under same JP-1 hostname.
  const assets=[...new Set([...index.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m=>m[1]))].slice(0,3);
  check('canary-has-static-assets',assets.length>0,{count:assets.length});
  for(let i=0;i<assets.length;i++){
   const asset=await request(host,assets[i]);
   check('canary-static-'+i,asset.status===200&&!asset.contentType.includes('text/html'),{
    status:asset.status,contentType:asset.contentType,bytes:asset.body.length});
  }
 }
}catch(e){check('canary-application-html',false,{error:e.name||'unknown'})}
for(const path of ['/api/state','/api/media','/api/records/growth']){
 try{
  const response=await request(host,path);
  check('canary-anonymous-denied-'+path,
    response.status===401&&!response.setCookie&&/no-store/i.test(response.cacheControl),{
      status:response.status,cacheControl:response.cacheControl,
      issuedCookie:!!response.setCookie});
 }catch(e){check('canary-anonymous-denied-'+path,false,{error:e.name||'unknown'})}
}
try{
 const response=await request(host,'/api/login',{
  method:'POST',headers:{'Content-Type':'application/json','Origin':'https://cross-origin.invalid'},
  body:'{}'
 });
 check('canary-csrf-origin-denied',response.status===403&&!response.setCookie,{
  status:response.status,issuedCookie:!!response.setCookie});
}catch(e){check('canary-csrf-origin-denied',false,{error:e.name||'unknown'})}
console.log('SAFE_JP_CANARY_SMOKE='+rows.filter(x=>x.ok).length+'/'+rows.length);
console.log('WARNING: Public read-only smoke only. No login, no private records, no writes, no mainland performance claim.');
if(process.env.GITHUB_STEP_SUMMARY){
 const fs=await import('node:fs/promises');
 const md=['### JP-1 canary migration gate','',
 '| Read-only check | Result |','|---|---|',
 ...rows.map(x=>'| '+x.name+' | '+(x.ok?'PASS':'FAIL')+' |'),
 '','The permanent production hostname is untouched. The test never authenticates or fetches private data.',''];
 await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,md.join('\n'));
}
if(failed)process.exitCode=1;
