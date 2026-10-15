import {PILOT_LISTEN_TIMEOUT_MS,PILOT_MAX_RESPONSE_CHARS,isPilotConnectionId,
 trustedWechatBase,type PilotCompletion} from './wechat-pilot';

interface PilotEnv {BOT:DurableObjectNamespace;PILOT_CONNECTION_ID?:string}
type Claim={leaseId:string;base:string;token:string;cursor:string};

// This worker is deployed separately from babymemo. It has *only* a DO binding,
// no D1 database or master encryption key, and no publicly routable fetch handler.
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
export default {
 async scheduled(_controller:ScheduledController,env:PilotEnv):Promise<void>{
  const connectionId=env.PILOT_CONNECTION_ID;
  // Fail closed until the operator explicitly provisions one pilot connection.
  if(!isPilotConnectionId(connectionId))return;
  const stub=env.BOT.get(env.BOT.idFromName('wechat:'+connectionId));
  const claimed=await stub.fetch('https://bot.internal/pilot/claim',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({connectionId})
  });
  if(!claimed.ok)return; // paused, stale session, busy or legacy poll in progress
  const claim=await claimed.json() as Claim;
  const result=await poll(claim);
  const finished=await stub.fetch('https://bot.internal/pilot/complete',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({connectionId,leaseId:claim.leaseId,result})
  });
  if(!finished.ok)console.warn(JSON.stringify({event:'WECHAT_PILOT_COMMIT_REJECTED',status:finished.status}));
 }
};
