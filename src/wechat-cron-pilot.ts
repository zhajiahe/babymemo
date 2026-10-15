import {PILOT_LISTEN_TIMEOUT_MS,PILOT_MAX_RESPONSE_CHARS,isPilotConnectionId,
 trustedWechatBase,type PilotCompletion} from './wechat-pilot';
import type {Env} from './types';

type Claim={leaseId:string;base:string;token:string;cursor:string};

// Runs inside the existing BabyMemo scheduled Worker, with no second deployment.
async function poll(claim:Claim):Promise<PilotCompletion>{
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),PILOT_LISTEN_TIMEOUT_MS);
 try{
  const base=trustedWechatBase(claim.base);
  const response=await fetch(base+'/ilink/bot/getupdates',{
   method:'POST',redirect:'manual',signal:ctrl.signal,
   headers:{
    'Content-Type':'application/json',
    'Authorization':'Bearer '+claim.token,
    'AuthorizationType':'ilink_bot_token',
    'X-WECHAT-UIN':btoa(String(crypto.getRandomValues(new Uint32Array(1))[0])),
    'iLink-App-Id':'bot',
    'iLink-App-ClientVersion':String((2<<16)|(4<<8)|10)
   },
   body:JSON.stringify({get_updates_buf:claim.cursor,base_info:{channel_version:'2.4.10',bot_agent:'BabyMemo/0.1'}})
  });
  if(!response.ok)return {kind:'error',code:response.status===401||response.status===403?'WECHAT_AUTH_EXPIRED':'WECHAT_HTTP_'+response.status};
  const raw=await response.text();
  // A malformed/oversized batch must be retried from the same cursor, never acknowledged.
  if(raw.length>PILOT_MAX_RESPONSE_CHARS)return {kind:'error',code:'WECHAT_NETWORK_ERROR'};
  return {kind:'response',raw};
 }catch{
  return ctrl.signal.aborted?{kind:'idle-timeout'}:{kind:'error',code:'WECHAT_NETWORK_ERROR'};
 }finally{clearTimeout(timer)}
}
async function pollOne(env:Pick<Env,'BOT'>,connectionId:string):Promise<void>{
 const stub=env.BOT.get(env.BOT.idFromName(connectionId==='legacy'?'family':'wechat:'+connectionId));
 const claimRequest=()=>stub.fetch('https://bot.internal/pilot/claim',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connectionId})
 });
 let claimed=await claimRequest();
 if(claimed.status===409){
  // Legacy Alarm listens for up to 8 seconds; wait once before giving up.
  // This prevents a fixed 30s Alarm / 60s Cron phase from starving takeover.
  const busy=await claimed.json().catch(()=>null) as {error?:string}|null;
  if(busy?.error==='POLL_BUSY'){
   await new Promise<void>(resolve=>setTimeout(resolve,9000));
   claimed=await claimRequest();
  }
 }
 if(!claimed.ok)return;
 const claim=await claimed.json() as Claim;
 const result=await poll(claim);
 const completed=await stub.fetch('https://bot.internal/pilot/complete',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({connectionId,leaseId:claim.leaseId,result})
 });
 if(!completed.ok)console.warn(JSON.stringify({event:'WECHAT_CRON_DELIVERY_REJECTED',status:completed.status}));
}
export async function runWechatCronPolling(env:Pick<Env,'BOT'|'DB'>):Promise<void>{
 // The legacy DO Alarm remains operational for accounts that Cron cannot serve.
 const enabled=await env.DB.prepare('SELECT id FROM wechat_connections WHERE enabled=1 ORDER BY id LIMIT 50')
   .all<{id:string}>();
 const ids=enabled.results.map(row=>row.id).filter(isPilotConnectionId);
 const settled=await Promise.allSettled(ids.map(id=>pollOne(env,id)));
 for(const result of settled){
  if(result.status==='rejected')console.error(JSON.stringify({event:'WECHAT_CRON_POLL_FAILED'}));
 }
}
