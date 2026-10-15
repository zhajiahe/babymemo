/** Cron long-poll in existing Worker, with DO Alarm fallback. */
export const PILOT_LISTEN_TIMEOUT_MS=35_000;
export const PILOT_LEASE_MS=120_000;
export const PILOT_WATCHDOG_MS=100_000;
export const PILOT_STALE_PAUSE_MS=60*60_000;
export const PILOT_MAX_RESPONSE_CHARS=1_000_000;

export type PilotLease={id:string;connectionId:string;expiresAt:number};
export type PilotCompletion=
 |{kind:'response';raw:string}
 |{kind:'idle-timeout'}
 |{kind:'error';code:string};

export function isPilotConnectionId(value:unknown):value is string {
 return value==='legacy'||(typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value));
}
export function isActivePilotLease(value:PilotLease|null|undefined,now=Date.now()):value is PilotLease {
 return !!value&&Number.isFinite(value.expiresAt)&&value.expiresAt>now&&typeof value.id==='string';
}
export function isPilotCompletion(value:unknown):value is PilotCompletion {
 if(!value||typeof value!=='object')return false;
 const v=value as Partial<PilotCompletion>&{raw?:unknown;code?:unknown};
 if(v.kind==='response')return typeof v.raw==='string'&&v.raw.length<=PILOT_MAX_RESPONSE_CHARS;
 if(v.kind==='idle-timeout')return true;
 if(v.kind==='error')return typeof v.code==='string'&&/^(WECHAT_AUTH_EXPIRED|WECHAT_NETWORK_ERROR|WECHAT_HTTP_[0-9]{3})$/.test(v.code);
 return false;
}
export function trustedWechatBase(value:string):string {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash||
   !/^ilinkai(?:[a-z0-9-]*\.)?weixin\.qq\.com$/i.test(u.hostname))throw Error('WECHAT_UNTRUSTED_BASE');
 return u.origin;
}
export function assertWechatPollResponse(response:unknown):asserts response is Record<string,unknown> {
 if(!response||typeof response!=='object'||Array.isArray(response))throw Error('WECHAT_PROTOCOL_ERROR');
 const data=response as Record<string,unknown>;
 if(data.ret===-14||data.errcode===-14)throw Error('WECHAT_STALE_TOKEN');
 if((data.ret!==undefined&&data.ret!==0)||(data.errcode!==undefined&&data.errcode!==0))
  throw Error('WECHAT_PROTOCOL_ERROR');
}
