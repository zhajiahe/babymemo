// Server-only structured diagnostics. Strict field allowlist deliberately excludes
// file names, URLs, message IDs, tokens, baby IDs, media metadata and content.
export function mediaSizeBand(size: number){
 if(!Number.isFinite(size)||size<0)return 'unknown';
 if(size<=1024*1024)return '<=1MiB';
 if(size<=5*1024*1024)return '1-5MiB';
 if(size<=8*1024*1024)return '5-8MiB';
 if(size<=50*1024*1024)return '8-50MiB';
 return '>50MiB';
}
export function mediaReadTiming({kind,status,size,d1Ms,r2Ms,totalMs,emit=console.info}:{
 kind:'thumbnail'|'original';status:number;size:number;d1Ms:number;r2Ms:number;totalMs:number;emit?:(line:string)=>void
}){
 const ms=(value:number)=>Math.min(600000,Math.max(0,Math.round(value)));
 const event={level:'info',event:'MEDIA_READ_TIMING',kind,status,
  sizeBand:mediaSizeBand(size),d1Ms:ms(d1Ms),r2Ms:ms(r2Ms),totalMs:ms(totalMs)};
 emit(JSON.stringify(event));
 return event;
}
export function mediaTiming({channel,stage,size,startedAt,status='ok',now=()=>performance.now(),emit=console.info}: {channel:string;stage:string;size:number;startedAt:number;status?:'ok'|'error';now?:()=>number;emit?:(message:string)=>void}){
 const channelName=['web','wechat'].includes(channel)?channel:'unknown';
 const stageName=['direct','part','finish','cdn','r2','thumbnail','index','total','client'].includes(stage)?stage:'unknown';
 const record={level:'info',event:'MEDIA_TRANSFER_TIMING',channel:channelName,stage:stageName,
  status:status==='ok'?'ok':'error',sizeBand:mediaSizeBand(size),
  durationMs:Math.min(600000,Math.max(0,Math.round(now()-startedAt)))};
 emit(JSON.stringify(record));
 return record;
}
