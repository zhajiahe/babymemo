#!/usr/bin/env node
// Smoke-check both Worker->D1 readiness and first-run secret configuration.
function origin(input){
 const u=new URL(input);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('BABYMEMO_PUBLIC_URL must be an HTTPS origin only');
 return u.origin;
}
async function workerOrigin(){
 if(process.env.BABYMEMO_PUBLIC_URL)return origin(process.env.BABYMEMO_PUBLIC_URL);
 const account=process.env.CLOUDFLARE_ACCOUNT_ID;
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!account||!token)throw Error('Set BABYMEMO_PUBLIC_URL or Cloudflare account/token for smoke checking');
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/workers/subdomain',{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)
 });
 if(!r.ok)throw Error('Could not resolve workers.dev subdomain (HTTP '+r.status+'); set BABYMEMO_PUBLIC_URL');
 const data=await r.json();
 const subdomain=data?.result?.subdomain;
 if(typeof subdomain!=='string'||!/^[a-z0-9-]+$/.test(subdomain))throw Error('No workers.dev subdomain; set BABYMEMO_PUBLIC_URL');
 return origin('https://babymemo.'+subdomain+'.workers.dev');
}
const base=await workerOrigin();
let last='no response';
for(let attempt=1;attempt<=8;attempt++){
 try{
  const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!health.ok)throw Error('health HTTP '+health.status);
  const info=await health.json();
  if(info?.ok!==true)throw Error('unhealthy Worker');
  const setup=await fetch(base+'/api/bootstrap/status',{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!setup.ok)throw Error('bootstrap HTTP '+setup.status);
  const ready=await setup.json();
  if(!ready.sessionConfigured||!ready.encryptionConfigured)
   throw Error('missing Worker secrets: SESSION_SECRET / DATA_KEY');
  console.log('Smoke check passed: '+base+' (Worker, D1, secrets)');
  process.exit(0);
 }catch(e){
  last=e instanceof Error?e.message:String(e);
  console.warn('Smoke attempt '+attempt+'/8: '+last);
  if(attempt<8)await new Promise(resolve=>setTimeout(resolve,4000));
 }
}
throw Error('Smoke check failed for '+base+': '+last);
