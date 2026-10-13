// Server-only structured diagnostics. Strict field allowlist deliberately excludes
// file names, URLs, message IDs, tokens, baby IDs, media metadata and content.
export function mediaSizeBand(size){
 if(!Number.isFinite(size)||size<0)return 'unknown';
 if(size<=1024*1024)return '<=1MiB';
 if(size<=5*1024*1024)return '1-5MiB';
 if(size<=8*1024*1024)return '5-8MiB';
 if(size<=50*1024*1024)return '8-50MiB';
 return '>50MiB';
}
export function mediaTiming({channel,stage,size,startedAt,status='ok',now=()=>performance.now(),emit=console.info}){
 const channelName=['web','wechat'].includes(channel)?channel:'unknown';
 const stageName=['direct','part','finish','cdn','r2','thumbnail','index','total','client'].includes(stage)?stage:'unknown';
 const record={level:'info',event:'MEDIA_TRANSFER_TIMING',channel:channelName,stage:stageName,
  status:status==='ok'?'ok':'error',sizeBand:mediaSizeBand(size),
  durationMs:Math.min(600000,Math.max(0,Math.round(now()-startedAt)))};
 emit(JSON.stringify(record));
 return record;
}
