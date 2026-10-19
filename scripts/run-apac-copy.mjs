// This GitHub Actions controller handles only aggregate JSON status; media remains in R2.
const base=process.env.APAC_COPY_URL||'https://babymemo-apac-copy.zhajiahe1994.workers.dev';
const secret=process.env.MIGRATION_TOKEN;
if(!secret||secret.length<32)throw Error('Missing migration token');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,method='GET'){
 const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(210000)});
 if(!response.ok)throw Error('Migration endpoint '+path.split('?')[0]+' returned '+response.status);
 return response.json();
}
let status;
for(let attempt=0;attempt<35;attempt++){
 try{status=await request('/status');break}catch(e){if(attempt===34)throw e;await sleep(4000)}
}
if(!status)throw Error('Migration status inaccessible');
for(let i=0;i<180&&!status.completed;i++){
 status=await request('/copy','POST');
 if(i%10===0||status.completed)console.log('Copy scanned='+status.scanned+' copied='+status.copied+' completed='+status.completed);
}
if(!status.completed)throw Error('Media transfer did not finish in the bounded number of passes');
let cursor='',verified=0,digests=0;
for(let i=0;i<180;i++){
 const result=await request('/verify'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
 if(result.mismatches)throw Error('Integrity failure in verification batch '+i);
 verified+=result.verified;digests+=result.checksumVerified;
 if(result.complete){
  if(verified!==status.scanned)throw Error('Source object count changed: scanned='+status.scanned+' verified='+verified);
  console.log('APAC_MEDIA_SHADOW_VERIFIED count='+verified+' checksum_verified='+digests);
  process.exit(0);
 }
 if(!result.cursor||result.cursor===cursor)throw Error('Verification cursor missing or repeated');
 cursor=result.cursor;
}
throw Error('Verification did not finish');
