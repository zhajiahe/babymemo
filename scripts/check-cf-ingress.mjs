// Public synthetic probes only. No app credentials, cookies or family records.
import dns from 'node:dns/promises';
const candidates=[
 {name:'baseline',host:'bm-speed.20250530.space',expected:null},
 {name:'orange-control',host:'bm-opt-ctl.20250530.space',expected:null},
 {name:'grey-A',host:'bm-opt-a.20250530.space',expected:'104.16.132.229'},
 {name:'grey-B',host:'bm-opt-b.20250530.space',expected:'188.114.96.3'},
 {name:'grey-C',host:'bm-opt-c.20250530.space',expected:'162.159.140.3'},
];
const rows=[];
for(const item of candidates){
 let resolved=[],dnsError='';
 try{resolved=await dns.resolve4(item.host)}catch(e){dnsError=e.code||e.message}
 const endpoints=[];
 for(const path of ['/probe/d1/enam','/probe/d1/apac','/cdn-cgi/trace']){
  const start=performance.now();
  try{
   const response=await fetch('https://'+item.host+path+'?t='+Date.now(),{
    headers:{'User-Agent':'BabyMemo-ingress-experiment/1.0'},
    signal:AbortSignal.timeout(15000),cache:'no-store'
   });
   const content=await response.text();
   let valid=false,colo='';
   if(path.endsWith('trace')){
    const m=content.match(/^colo=([A-Z]{3})$/m);colo=m?.[1]||'';
    valid=response.ok&&!!colo;
   }else{
    try{const body=JSON.parse(content);valid=response.ok&&body.ok===true&&body.region===path.split('/').at(-1);colo=body.colo||''}catch{}
   }
   endpoints.push({path,code:response.status,valid,ms:Math.round(performance.now()-start),colo});
  }catch(e){endpoints.push({path,error:e.name==='TimeoutError'?'TIMEOUT':e?.cause?.code||e.name||'FETCH_FAILED',valid:false})}
 }
 rows.push({name:item.name,host:item.host,dns:resolved,correctDns:!item.expected||resolved.includes(item.expected),dnsError,endpoints});
}
for(const entry of rows)console.log(JSON.stringify(entry));
const all=rows.map(x=>({
 host:x.host,dns:x.correctDns?'ok':'check',
 probe:x.endpoints.filter(e=>e.valid&&e.path!=='/cdn-cgi/trace').length+'/2',
 colo:x.endpoints.find(e=>e.path==='/cdn-cgi/trace')?.colo||'—',
 status:x.endpoints.every(e=>e.valid)?'PASS':'CHECK'
}));
console.log('\nSUMMARY\n'+all.map(x=>[x.host,x.dns,x.probe,x.colo,x.status].join('\t')).join('\n'));
if(process.env.GITHUB_STEP_SUMMARY){
 const fs=await import('node:fs/promises');
 const lines=['### Independent Cloudflare ingress lab','', '| Host | DNS | Synthetic D1 probes | colo | Status |','|---|---|---|---|---|',
  ...all.map(x=>[x.host,x.dns,x.probe,x.colo,x.status].join(' | ').replace(/^/,'| ').replace(/$/,' |')),'',
  'A GitHub runner is not a mainland-China network. Real user carrier tests remain necessary.',''];
 await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n'));
}
