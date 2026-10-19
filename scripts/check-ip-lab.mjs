// Public-only smoke test, does not require Cloudflare credentials or private family data.
import dns from 'node:dns/promises';
import {writeFile} from 'node:fs/promises';
const hosts=[
 {name:'baseline',host:'bm-ip-lab.20250530.space',ip:null},
 {name:'legacy-B',host:'bm-opt-b.20250530.space',ip:'188.114.96.3'},
 {name:'SG-1',host:'bm-lab-s1.20250530.space',ip:'104.18.36.27'},
 {name:'SG-2',host:'bm-lab-s2.20250530.space',ip:'104.18.41.37'},
 {name:'SG-3',host:'bm-lab-s3.20250530.space',ip:'172.64.156.80'},
 {name:'JP-1',host:'bm-lab-j1.20250530.space',ip:'172.64.229.191'},
 {name:'US-1',host:'bm-lab-u1.20250530.space',ip:'104.19.228.197'},
 {name:'US-2',host:'bm-lab-u2.20250530.space',ip:'104.16.166.147'}
];
const origin='https://bm-ip-lab.20250530.space';
async function check({name,host,ip}){
 const row={name,host,ip,dns:[],dnsMatch:false,d1:null,r2:null,colo:null,errors:[]};
 try{row.dns=await dns.resolve4(host);row.dnsMatch=!ip||row.dns.includes(ip)}
 catch(e){row.errors.push('DNS '+(e.code||e.name))}
 for(const kind of ['d1','r2','media']){
  const start=performance.now();
  try{
   const resp=await fetch('https://'+host+'/probe/'+kind+'/enam',{headers:{Origin:origin},signal:AbortSignal.timeout(11000),cache:'no-store'});
   const cors=resp.headers.get('access-control-allow-origin')===origin;
   if(kind==='media'){
    const bytes=(await resp.arrayBuffer()).byteLength;
    row[kind]={ok:resp.ok&&cors&&bytes===262144,status:resp.status,ms:Math.round(performance.now()-start),cors,bytes,colo:resp.headers.get('x-probe-colo')||null};
   }else{
    const payload=await resp.json().catch(()=>null);
    row[kind]={ok:resp.ok&&payload?.ok===true&&cors&&payload.kind===kind&&payload.region==='enam',status:resp.status,ms:Math.round(performance.now()-start),cors,colo:payload?.colo||null};
   }
  }catch(e){row[kind]={ok:false,error:e.name||'UNKNOWN'}}
 }
 try{
  const resp=await fetch('https://'+host+'/cdn-cgi/trace',{signal:AbortSignal.timeout(11000)});
  const body=await resp.text(),match=body.match(/^colo=([A-Z]{3})$/m);
  row.colo=match?.[1]||null;
 }catch(e){row.errors.push('TRACE '+e.name)}
 return row;
}
const results=await Promise.all(hosts.map(check));
for(const entry of results)console.log(JSON.stringify(entry));
const baseline=results[0];
if(!baseline.d1?.ok||!baseline.r2?.ok||!baseline.media?.ok)process.exitCode=1;
const valid=results.filter(r=>r.ip&&r.d1?.ok&&r.r2?.ok&&r.media?.ok);
console.log('WORKING_CANDIDATES='+valid.length+'/'+(results.length-1));
console.log('NOTE: GitHub runner is not a China mainland ISP; these are compatibility checks only.');
if(process.env.GITHUB_STEP_SUMMARY){
 const summary=['## BabyMemo 优选入口第二轮：公网兼容性','',
 '| 入口 | DNS | D1 | R2 | 256KB 合成媒体 | Cloudflare 节点 |','|---|---|---|---|---|',
 ...results.map(r=>[r.name,r.dnsMatch?'OK':'NO',r.d1?.ok?'OK':r.d1?.status||'FAIL',r.r2?.ok?'OK':r.r2?.status||'FAIL',r.media?.ok?'OK':r.media?.status||'FAIL',r.colo||'—'].join(' | ').replace(/^/,'| ').replace(/$/,' |')),
 '','所有请求均为公开合成测试，不使用家庭资料。GitHub Runner 的节点不代表大陆手机路由。'];
 await (await import('node:fs/promises')).appendFile(process.env.GITHUB_STEP_SUMMARY,summary.join('\n'));
}

const focused=results.filter(x=>['baseline','JP-1','SG-2'].includes(x.name));
let largeOk=0;
for(const item of focused){
 for(const type of ['full','range']){
  const url='https://'+item.host+'/probe/large/'+type+'/enam';
  const opts={headers:{Origin:origin,...(type==='range'?{Range:'bytes=0-262143'}:{})},cache:'no-store',signal:AbortSignal.timeout(25000)};
  try{
   const r=await fetch(url,opts);
   const size=(await r.arrayBuffer()).byteLength;
   const ok=r.status===(type==='range'?206:200)&&size===(type==='range'?262144:2097152)&&r.headers.get('access-control-allow-origin')===origin&&(type!=='range'||r.headers.get('content-range')==='bytes 0-262143/2097152');
   if(ok)largeOk++;
   console.log(JSON.stringify({mediaHost:item.host,type,status:r.status,bytes:size,ok,colo:r.headers.get('x-probe-colo')}));
  }catch(e){console.log(JSON.stringify({mediaHost:item.host,type,ok:false,error:e.name||'UNKNOWN'}))}
 }
}
console.log('LARGE_AND_RANGE_OK='+largeOk+'/6');
if(largeOk!==6)process.exitCode=1;
