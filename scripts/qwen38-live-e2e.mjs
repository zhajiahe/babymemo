#!/usr/bin/env node
// Manual real Cloudflare Workers AI Qwen3.8-27B assessment, NOT automatic CI.
// 10 invented WeChat family tasks, real LLM inferences, ONLY synthetic tool
// observations. Does not read/write production D1/R2 or send WeChat messages.
import {wechatTools} from '../src/wechat-harness.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
import {qwenRequest,DEFAULT_QWEN_MODEL} from '../src/qwen-workers-ai.mjs';
if(process.env.QWEN38_LIVE_CONFIRM!=='YES')throw Error('MANUAL_CONFIRMATION_REQUIRED');
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!accountId||!token)throw Error('CLOUDFLARE_ACCOUNT_ID_OR_API_TOKEN_MISSING');
const cases=[
 ['查询最近体重','查询测试宝宝最近五条体重记录',['list_growth']],
 ['新增身高体重','测试宝宝今天体重10.5kg，身高82cm，帮我记录',['create_growth']],
 ['新增里程碑','测试宝宝今天第一次自己走了五步，记成里程碑',['create_milestone']],
 ['查询成长瞬间','测试宝宝最近有哪些成长瞬间',['list_milestones']],
 ['区间体重汇总','汇总测试宝宝2026年10月1日到10月10日的体重变化',['growth_summary','list_growth']],
 ['先查后改','把测试宝宝昨天的体重10.5kg，先查出来，再更正成10.2kg',['list_growth','update_growth']],
 ['否定写入','不要保存，刚才说的10.5kg只是猜的，没实际称重',[]],
 ['相册查询','看看测试宝宝10月1日的照片',['list_media']],
 ['最近照片日期','把刚才发的照片日期改成昨天',['update_recent_media']],
 ['查询并恢复','从测试宝宝回收站找出10月1日的体重记录并恢复',['list_trash','restore_trash']]
];
const record={requests:0,inputTokens:0,outputTokens:0,cachedTokens:0,neurons:0};
const maxNeurons=Number(process.env.QWEN38_MAX_NEURONS||3500);
if(!Number.isFinite(maxNeurons)||maxNeurons<1||maxNeurons>10000)throw Error('INVALID_MAX_NEURONS');
function observation(name){
 if(name==='get_runtime_context')return JSON.stringify({messageLocalDay:'2026-10-14',timeZone:'Asia/Shanghai',targetBaby:'测试宝宝'});
 if(name==='list_growth')return '测试宝宝成长测量：aaaaaaaa · 2026-10-13 · 体重 10.5kg 身高 82cm';
 if(name==='list_trash')return '测试宝宝回收站：aaaaaaaa · 2026-10-01 · 体重 10.5kg';
 if(name==='list_milestones')return '测试宝宝成长事件：bbbbbbbb · 2026-10-01 · 第一次走路';
 if(name==='list_media')return '测试宝宝相册：cccccccc · 2026-10-01 · image/jpeg';
 if(name==='growth_summary')return '体重从10.0kg增长至10.5kg，增加0.5kg';
 if(name==='get_baby')return '虚构测试宝宝资料：生日2025-05-30';
 if(name==='list_babies')return '家庭只有一位测试宝宝';
 if(name.startsWith('create_'))return '已保存成长记录（编号 aaaaaaaa）。';
 if(name.startsWith('update_'))return '已更新成长记录（编号 aaaaaaaa）。';
 if(name.startsWith('delete_'))return '已将记录移到回收站。';
 if(name.startsWith('restore_'))return '已恢复记录（编号 aaaaaaaa）。';
 return '查询成功（仅模拟，不修改真实数据）。';
}
const results=[];
for(let i=0;i<cases.length;i++){
 const [label,input,expected]=cases[i],selected=[],details=[],before={...record};
 let failure=null,answer='';
 const ai={run:async(model,params)=>{
  if(model!==DEFAULT_QWEN_MODEL)throw Error('WRONG_MODEL');
  if(record.neurons>=maxNeurons)throw Error('LOCAL_NEURON_BUDGET_REACHED');
  if(record.requests>=50)throw Error('MODEL_REQUEST_COUNT_LIMIT');
  if(params.chat_template_kwargs?.enable_thinking!==false)throw Error('THINKING_NOT_DISABLED');
  // REST endpoint uses exact same Workers AI model and compatible request fields
  // as the production env.AI.run binding.
  record.requests++;
  const timer=new AbortController(),timeout=setTimeout(()=>timer.abort(),45000);
  try{
   const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+accountId+
    '/ai/run/@cf/qwen/qwen3.8-27b',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
     body:JSON.stringify(params),signal:timer.signal});
   const envelope=await response.json().catch(()=>null);
   if(!response.ok||envelope?.success===false){
    const code=String(envelope?.errors?.[0]?.code||response.status).replace(/[^\d]/g,'').slice(0,6);
    throw Error('CLOUDFLARE_MODEL_HTTP_'+code);
   }
   const result=envelope?.result||envelope;
   if(!result?.usage||typeof result.usage.neurons!=='number')throw Error('MISSING_USAGE');
   record.neurons+=result.usage.neurons;
   record.inputTokens+=result.usage.prompt_tokens||0;
   record.outputTokens+=result.usage.completion_tokens||0;
   record.cachedTokens+=result.usage.prompt_tokens_details?.cached_tokens||0;
   return result;
  }finally{clearTimeout(timeout)}
 }};
 try{
  answer=await runWechatAgentLoop({
   messages:[{role:'system',content:'你是 BabyMemo 微信助手，今天2026-10-14，时区Asia/Shanghai，用户家庭只有虚构宝宝“测试宝宝”。直接使用可用工具完成任务；观察工具结果后请适时回答，不要重复查询。没有实测不得保存，用户否定就不执行写入。'},
    {role:'user',content:input}],
   tools:wechatTools,
   complete:async({messages,tools})=>ai.run(DEFAULT_QWEN_MODEL,qwenRequest({messages,tools,max_tokens:400})),
   execute:async call=>{
    const name=call.function.name;selected.push(name);
    let args={};try{args=JSON.parse(call.function.arguments)}catch{details.push('INVALID_JSON')}
    details.push({name,args});
    if(/^(create_|update_|delete_|restore_)/.test(name)&&!expected.includes(name))
     return {content:'无授权写入，未修改家庭数据。',committed:false,halt:true};
    return {content:observation(name),committed:/^(create_|update_|delete_|restore_)/.test(name)};
   }
  });
 }catch(error){failure=error instanceof Error?error.message:'UNKNOWN_ERROR'}
 const mutating=selected.filter(name=>/^(create_|update_|delete_|restore_)/.test(name));
 let passed=expected.length===0?mutating.length===0:expected.some(x=>selected.includes(x));
 if(label==='先查后改')passed=selected.indexOf('list_growth')>=0&&selected.indexOf('update_growth')>selected.indexOf('list_growth');
 if(label==='查询并恢复')passed=selected.indexOf('list_trash')>=0&&selected.indexOf('restore_trash')>selected.indexOf('list_trash');
 if(failure||!answer||answer.includes('轮数上限')||details.includes('INVALID_JSON'))passed=false;
 results.push({case:i+1,label,expected,selected,passed,failure,modelRequests:record.requests-before.requests,
  inputTokens:record.inputTokens-before.inputTokens,outputTokens:record.outputTokens-before.outputTokens,
  neurons:Number((record.neurons-before.neurons).toFixed(4)),replyPreview:answer.slice(0,100)});
 if(failure==='LOCAL_NEURON_BUDGET_REACHED'||failure==='MODEL_REQUEST_COUNT_LIMIT')break;
}
console.log(JSON.stringify({model:DEFAULT_QWEN_MODEL,reasoning:'disabled',freeDailyNeurons:10000,
 syntheticData:true,productionWrites:0,plannedCases:10,casesCompleted:results.length,
 success:results.filter(x=>x.passed).length,...record,estimatedTokenUSD:(record.inputTokens*.45+record.outputTokens*3.20)/1e6,results},null,2));
if(results.length!==10||results.some(x=>!x.passed))process.exitCode=1;
