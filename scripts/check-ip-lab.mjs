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
 for(const kind of ['d1','r2']){
  const start=performance.now();
  try{
   const resp=await fetch('https://'+host+'/probe/'+kind+'/enam',{headers:{Origin:origin},signal:AbortSignal.timeout(11000),cache:'no-store'});
   const payload=await resp.json().catch(()=>null);
   const cors=resp.headers.get('access-control-allow-origin')===origin;
   row[kind]={ok:resp.ok&&payload?.ok===true&&cors&&payload.kind===kind&&payload.region==='enam',status:resp.status,ms:Math.round(performance.now()-start),cors,colo:payload?.colo||null};
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
if(!baseline.d1?.ok||!baseline.r2?.ok)process.exitCode=1;
const valid=results.filter(r=>r.ip&&r.d1?.ok&&r.r2?.ok);
console.log('WORKING_CANDIDATES='+valid.length+'/'+(results.length-1));
console.log('NOTE: GitHub runner is not a China mainland ISP; these are compatibility checks only.');
if(process.env.GITHUB_STEP_SUMMARY){
 const summary=['## BabyMemo 优选入口第二轮：公网兼容性','',
 '| 入口 | DNS | D1 | R2 | Cloudflare 节点 |','|---|---|---|---|---|',
 ...results.map(r=>[r.name,r.dnsMatch?'OK':'NO',r.d1?.ok?'OK':r.d1?.status||'FAIL',r.r2?.ok?'OK':r.r2?.status||'FAIL',r.colo||'—'].join(' | ').replace(/^/,'| ').replace(/$/,' |')),
 '','所有请求均为公开合成测试，不使用家庭资料。GitHub Runner 的节点不代表大陆手机路由。'];
 await (await import('node:fs/promises')).appendFile(process.env.GITHUB_STEP_SUMMARY,summary.join('\n'));
}
