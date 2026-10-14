#!/usr/bin/env node
// MANUAL ONLY. Real, billable Anthropic Haiku 5.5 through Cloudflare AI Gateway.
// 10 realistic but synthetic WeChat conversations. No production BabyMemo D1/R2/WeChat.
// Run only after loading Gateway credits and setting the three explicit opt-in env vars.
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
import {wechatTools} from '../src/wechat-harness.mjs';
import {haikuGatewayCompletion,haiku55Cost,DEFAULT_HAIKU_MODEL} from '../src/haiku-gateway.mjs';

if(process.env.HAIKU55_LIVE_CONFIRM!=='YES')throw Error('MANUAL_CONFIRMATION_REQUIRED');
const token=process.env.CLOUDFLARE_API_TOKEN,accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!accountId)throw Error('CLOUDFLARE_CREDENTIALS_MISSING');
const maxUSD=Number(process.env.HAIKU55_MAX_USD||0.10);
if(!Number.isFinite(maxUSD)||maxUSD<=0||maxUSD>1)throw Error('INVALID_MAX_BUDGET');
const cases=[
 ['查询最近体重','查询测试宝宝最近五次体重记录',['list_growth']],
 ['记录身高体重','测试宝宝今天体重10.5kg，身高82cm，帮我记录',['create_growth']],
 ['新增里程碑','测试宝宝今天第一次自己走了五步，记到里程碑',['create_milestone']],
 ['最近里程碑查询','测试宝宝最近有哪些成长瞬间',['list_milestones']],
 ['按日期搜索','查测试宝宝2026年10月1日到10月10日的体重变化',['growth_summary','list_growth']],
 ['多轮先查后改','测试宝宝昨天体重10.5kg，帮我找出来再改成10.2kg',['list_growth','update_growth']],
 ['否定禁止写入','不要保存，这个体重10.5kg只是估计，没称重',[]],
 ['查询相册','看测试宝宝10月1日的照片',['list_media']],
 ['最近照片更改','把刚才发送的测试宝宝照片日期改成昨天',['update_recent_media']],
 ['恢复记录','把测试宝宝回收站里10月1日的体重找出来再恢复',['list_trash','restore_trash']]
];
const summarizeName=name=>/^(?:create_|update_|delete_|restore_)/.test(name);
function observation(name){
 if(name==='get_runtime_context')return JSON.stringify({messageLocalDay:'2026-10-14',timeZone:'Asia/Shanghai',targetBaby:'测试宝宝'});
 if(name==='list_growth')return '测试宝宝的成长测量：\naaaaaaaa · 2026-10-13 · 体重10.5kg，身高82cm';
 if(name==='list_milestones')return '测试宝宝的成长事件：\nbbbbbbbb · 2026-10-01 · 第一次走路';
 if(name==='list_media')return '测试宝宝的相册内容：\ncccccccc · 2026-10-01 · image/jpeg';
 if(name==='list_trash')return '回收站：aaaaaaaa · 2026-10-01 · 体重10.5kg';
 if(name==='growth_summary')return '体重从10.0kg变为10.5kg，增长0.5kg';
 if(name==='search_records')return '测试宝宝查询结果：aaaaaaaa · 2026-10-13 · 体重10.5kg';
 if(name==='get_baby')return '测试宝宝的档案：出生于2025-05-30';
 if(name==='list_babies')return '家庭有测试宝宝一人';
 if(name.startsWith('create_'))return '已保存成长记录（编号 aaaaaaaa）。';
 if(name.startsWith('update_'))return '已更新成长记录（编号 aaaaaaaa）。';
 if(name.startsWith('delete_'))return '已将记录移到回收站。';
 if(name.startsWith('restore_'))return '已恢复记录（编号 aaaaaaaa）。';
 return '模拟工具读取成功，无生产数据库操作。';
}
let usd=0,modelRequests=0,inputTokens=0,outputTokens=0,cacheRead=0,cacheWrite=0,good=0;
const results=[];
for(let i=0;i<cases.length;i++){
 const [name,input,expect]=cases[i],actual=[],errors=[];
 let caseUSD=0,caseCalls=0,caseInput=0,caseOutput=0;
 async function run(model,payload){
  if(usd>=maxUSD)throw Error('LOCAL_BUDGET_REACHED');
  if(modelRequests>=60)throw Error('MODEL_REQUEST_CEILING');
  modelRequests++;caseCalls++;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),45000);
  try{
   const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({model,input:payload,options:{gateway:{id:'gateway',skipCache:true}}}),signal:ctrl.signal
   });
   const raw=await response.json().catch(()=>null);
   if(!response.ok||raw?.success===false){
    const code=raw?.errors?.[0]?.code||response.status;
    if(code===2021||/balance/i.test(raw?.errors?.[0]?.message||''))throw Error('INSUFFICIENT_GATEWAY_BALANCE');
    throw Error('GATEWAY_HTTP_'+String(code).replace(/[^0-9]/g,'').slice(0,6));
   }
   const result=raw?.result||raw;
   const usage=haiku55Cost(result?.usage);
   if(!usage)throw Error('MISSING_PROVIDER_TOKEN_USAGE');
   inputTokens+=usage.inputTokens;outputTokens+=usage.outputTokens;
   cacheRead+=usage.cacheReadTokens;cacheWrite+=usage.cacheWriteTokens;
   usd+=usage.estimatedUSD;caseUSD+=usage.estimatedUSD;
   caseInput+=usage.inputTokens;caseOutput+=usage.outputTokens;
   return result;
  }finally{clearTimeout(timer)}
 }
 try{
  const reply=await runWechatAgentLoop({
   messages:[{role:'system',content:'你是 BabyMemo 微信家庭成长记录助手。当前是2026-10-14，虚构宝宝名为“测试宝宝”。可以查询后修改；必须用工具进行读写。禁止杜撰测量值、未执行就声称写入或把否定消息当作命令。所有数据仅用于评测。'},
     {role:'user',content:input}],tools:wechatTools,
   complete:({messages,tools})=>haikuGatewayCompletion({run,messages,tools,max_tokens:900}),
   finalize:({messages})=>haikuGatewayCompletion({run,messages,max_tokens:300}),
   execute:async call=>{
    let args={};try{args=JSON.parse(call.function.arguments)}catch{errors.push('INVALID_TOOL_JSON')}
    const name=call.function.name;actual.push(name);
    if(summarizeName(name)&&!expect.includes(name))errors.push('UNAUTHORIZED_MUTATION');
    const permitted=wechatTools.find(x=>x.function.name===name);
    if(!permitted)errors.push('UNKNOWN_TOOL');
    if(!args||typeof args!=='object'||Array.isArray(args))errors.push('INVALID_TOOL_ARGS');
    return {content:observation(name),committed:summarizeName(name)&&!errors.length};
   }
  });
  let match=expect.length===0?!actual.some(summarizeName):expect.some(v=>actual.includes(v));
  if(name==='多轮先查后改')match=actual.includes('list_growth')&&actual.includes('update_growth')&&actual.indexOf('list_growth')<actual.indexOf('update_growth');
  if(name==='恢复记录')match=actual.includes('list_trash')&&actual.includes('restore_trash');
  if(match&&!errors.length)good++;
  results.push({case:i+1,name,expected:expect,actual,matched:match&&!errors.length,errors,modelRequests:caseCalls,inputTokens:caseInput,outputTokens:caseOutput,costUSD:Number(caseUSD.toFixed(7)),replyPreview:String(reply).slice(0,100)});
 }catch(e){
  const code=e instanceof Error&&/^(INSUFFICIENT_GATEWAY_BALANCE|LOCAL_BUDGET_REACHED|MODEL_REQUEST_CEILING|GATEWAY_HTTP_\d+|MISSING_PROVIDER_TOKEN_USAGE)$/.test(e.message)?e.message:'MODEL_OR_AGENT_ERROR';
  results.push({case:i+1,name,modelRequests:caseCalls,costUSD:Number(caseUSD.toFixed(7)),error:code});
  if(code==='INSUFFICIENT_GATEWAY_BALANCE'||code==='LOCAL_BUDGET_REACHED'||code==='MODEL_REQUEST_CEILING')break;
 }
}
console.log(JSON.stringify({model:DEFAULT_HAIKU_MODEL,provider:'Cloudflare AI Gateway Unified Billing - THIRD PARTY',freeNeuronsUsed:0,
 syntheticFamilyData:true,productionWrites:0,plannedCases:10,completedCases:results.length,matched:good,modelRequests,
 usage:{inputTokens,outputTokens,cacheRead,cacheWrite},estimatedProviderCostUSD:Number(usd.toFixed(7)),
 maxUSD,results},null,2));
if(results.length!==10||good<8)process.exitCode=1;
