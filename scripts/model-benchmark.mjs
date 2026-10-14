#!/usr/bin/env node
// Manual ONLY: same ten virtual-family tasks, exact BabyMemo tool schema,
// same prompts/observations/scoring for Qwen Workers AI and Muse OpenRouter.
// No production WeChat, D1, R2, personal messages or real tool side effects.
import {writeFile} from 'node:fs/promises';
import {wechatTools} from '../src/wechat-harness.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
import {qwenCompletion,qwenRequest,DEFAULT_QWEN_MODEL} from '../src/qwen-workers-ai.mjs';
import {openRouterCompletion} from '../src/openrouter-retry.mjs';
import {DEFAULT_OPENROUTER_MODEL,GPT_6_LUNA,CLAUDE_HAIKU_55} from '../src/openrouter-model.mjs';
import {openRouterReasoningForModel,DEEPSEEK_V41_FLASH} from '../src/openrouter-retry.mjs';
import {diagnosticEvent,safeBenchPreview,benchmarkFailureKind,isFatalBenchmarkError,benchmarkMarkdownReport} from './model-benchmark-logging.mjs';
import {MODEL_BENCH_CASES,BENCHMARK_SYSTEM,syntheticObservation,validateBenchmarkTool,scoreModelCase,aggregateBenchmark} from './model-benchmark-cases.mjs';

if(process.env.MODEL_BENCH_CONFIRM!=='YES')throw Error('MANUAL_CONFIRMATION_REQUIRED');
const provider=process.env.MODEL_BENCH_PROVIDER||'both';
if(!['workers-ai','openrouter','both'].includes(provider))throw Error('INVALID_PROVIDER');
const repetitions=Number(process.env.MODEL_BENCH_REPETITIONS||1);
if(!Number.isInteger(repetitions)||repetitions<1||repetitions>3)throw Error('REPETITIONS_OUT_OF_RANGE');
const maxNeurons=Number(process.env.MODEL_BENCH_MAX_NEURONS||3000);
const maxUSD=Number(process.env.MODEL_BENCH_MAX_USD||0.10);
if(!Number.isFinite(maxNeurons)||maxNeurons<=0||maxNeurons>10000||!Number.isFinite(maxUSD)||maxUSD<=0||maxUSD>1)
 throw Error('INVALID_BENCHMARK_BUDGET');
const openRouterModel=process.env.MODEL_BENCH_OPENROUTER_MODEL||DEFAULT_OPENROUTER_MODEL;
if(!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(openRouterModel))throw Error('INVALID_OPENROUTER_MODEL');
const reasoningMode=process.env.MODEL_BENCH_REASONING_MODE||'auto';
if(!['auto','off','low'].includes(reasoningMode))throw Error('INVALID_REASONING_MODE');
const effectiveReasoning=reasoningMode==='auto'&&[DEEPSEEK_V41_FLASH,GPT_6_LUNA,CLAUDE_HAIKU_55].includes(openRouterModel)?'off':reasoningMode;
const selected=provider==='both'?['workers-ai','openrouter']:[provider];
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,apiToken=process.env.CLOUDFLARE_AI_API_TOKEN||process.env.CLOUDFLARE_API_TOKEN,openRouterKey=process.env.OPENROUTER_API_KEY;
if(selected.includes('workers-ai')&&!process.env.CLOUDFLARE_AI_API_TOKEN)console.warn('[model-benchmark] Dedicated CLOUDFLARE_AI_API_TOKEN not provided; deploy token may lack Workers AI → Read. Authentication failures stop after first request.');
if(selected.includes('workers-ai')&&(!accountId||!apiToken))throw Error('WORKERS_AI_CREDENTIALS_MISSING');
if(selected.includes('openrouter')&&(!openRouterKey||!openRouterKey.startsWith('sk-or-')))throw Error('OPENROUTER_KEY_MISSING');

const spent={neurons:0,usd:0,requests:0},maximumRequests=repetitions*10*6*selected.length;
const log=(stage,details)=>console.log(diagnosticEvent(stage,details));
async function request(provider,messages,tools,maxTokens=1200,meta={}){
 const model=provider==='workers-ai'?DEFAULT_QWEN_MODEL:openRouterModel;
 const context={provider,model,caseId:meta.caseId,iteration:meta.iteration,request:meta.request};
 const started=Date.now();
 log('model_request_start',{...context,toolCount:tools?.length||0,messageCount:messages.length,reasoningRequested:provider==='workers-ai'?'off':effectiveReasoning});
 if(spent.requests>=maximumRequests)throw Error('MODEL_REQUEST_LIMIT');
 if(provider==='workers-ai'){
  if(spent.neurons>=maxNeurons)throw Error('WORKERS_AI_SOFT_BUDGET_REACHED');
  spent.requests++;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
  try{
   const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+accountId+'/ai/run/'+DEFAULT_QWEN_MODEL,{
    method:'POST',headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},
    body:JSON.stringify(qwenRequest({messages,tools,max_tokens:maxTokens})),signal:controller.signal
   });
   const json=await response.json().catch(()=>null);
   if(!response.ok||json?.success===false){
    const code=String(json?.errors?.[0]?.code||response.status).replace(/[^0-9]/g,'').slice(0,6);
    log('model_request_failed',{...context,elapsedMs:Date.now()-started,httpStatus:response.status,upstreamCode:code,category:benchmarkFailureKind('WORKERS_AI_HTTP_'+code)});
    throw Error('WORKERS_AI_HTTP_'+code);
   }
   const raw=json?.result??json,usage=raw?.usage;
   if(!usage||!Number.isFinite(usage.neurons))throw Error('WORKERS_AI_USAGE_MISSING');
   spent.neurons+=usage.neurons;
   const choice=raw?.choices?.[0],message=choice?.message;
   log('model_request_complete',{...context,elapsedMs:Date.now()-started,finishReason:choice?.finish_reason||'unknown',inputTokens:usage.prompt_tokens??null,outputTokens:usage.completion_tokens??null,neurons:usage.neurons,reasoningTokens:usage.completion_tokens_details?.reasoning_tokens??null,toolNames:message?.tool_calls?.map(x=>x?.function?.name),assistant:message?.tool_calls?.length?undefined:message?.content});
   return {response:raw,usage:{
    inputTokens:usage.prompt_tokens??null,outputTokens:usage.completion_tokens??null,
    neurons:usage.neurons,reportedUSD:null,reasoningTokens:usage.completion_tokens_details?.reasoning_tokens??null
   }};
  }finally{clearTimeout(timeout)}
 }
 if(spent.usd>=maxUSD)throw Error('OPENROUTER_SOFT_BUDGET_REACHED');
 spent.requests++;
 let response;
 try{response=await openRouterCompletion({key:openRouterKey,model:openRouterModel,messages,tools,max_tokens:maxTokens,maxAttempts:1,reasoningMode});}
 catch(error){const code=error instanceof Error?error.message:'UNKNOWN_ERROR';log('model_request_failed',{...context,elapsedMs:Date.now()-started,status:benchmarkFailureKind(code)});throw error;}
 const usage=response?.usage??{};
 // OpenRouter cost is USD when present. Do not invent billed dollars when absent.
 const cost=typeof usage.cost==='number'&&Number.isFinite(usage.cost)?usage.cost:
   typeof response?.total_cost==='number'&&Number.isFinite(response.total_cost)?response.total_cost:null;
 if(cost!==null)spent.usd+=cost;
 const choice=response?.choices?.[0],message=choice?.message;
 const applied=response?._babymemo_request||{};
 const reasoningTokens=usage.completion_tokens_details?.reasoning_tokens??usage.output_tokens_details?.reasoning_tokens??null;
 log('model_request_complete',{...context,elapsedMs:Date.now()-started,finishReason:choice?.finish_reason||'unknown',inputTokens:usage.prompt_tokens??null,outputTokens:usage.completion_tokens??null,reasoningTokens,reportedUSD:cost,reasoningFallbackUsed:!!applied.reasoningFallbackUsed,
  actualReasoningRequested:applied.reasoningRequested??null,requestedProvider:applied.requestedProvider?.only?.[0]??null,
  servedProvider:response?.provider??null,toolNames:message?.tool_calls?.map(x=>x?.function?.name),assistant:message?.tool_calls?.length?undefined:message?.content});
 return {response,usage:{
  inputTokens:usage.prompt_tokens??null,outputTokens:usage.completion_tokens??null,
  neurons:null,reportedUSD:cost,reasoningTokens,reasoningFallbackUsed:!!applied.reasoningFallbackUsed,
  requestedProvider:applied.requestedProvider?.only?.[0]??null,servedProvider:response?.provider??null
 }};
}
async function evaluate(modelProvider,item,iteration){
 const calls=[],issues=[],usage={inputTokens:0,outputTokens:0,neurons:modelProvider==='workers-ai'?0:null,reportedUSD:modelProvider==='openrouter'?0:null,reasoningTokens:0};
 const caseContext={provider:modelProvider,model:modelProvider==='workers-ai'?DEFAULT_QWEN_MODEL:openRouterModel,caseId:item.id,iteration};
 log('scenario_start',{...caseContext,reasoningRequested:modelProvider==='workers-ai'?'off':effectiveReasoning});
 const started=Date.now();let modelRequests=0,reply='',error=null,modelFinal='',reasoningFallbackUsed=false,requestedProvider=null,servedProvider=null;
 const complete=async({messages,tools},maxTokens=1200)=>{
  const result=await request(modelProvider,messages,tools,maxTokens,{caseId:item.id,iteration,request:modelRequests+1});modelRequests++;
  reasoningFallbackUsed ||=!!result.usage.reasoningFallbackUsed;
  requestedProvider=result.usage.requestedProvider??requestedProvider;
  servedProvider=result.usage.servedProvider??servedProvider;
  for(const key of ['inputTokens','outputTokens','neurons','reportedUSD','reasoningTokens']){
   if(usage[key]===null||result.usage[key]===null){usage[key]=null;continue}
   usage[key]+=result.usage[key];
  }
  const text=result.response?.choices?.[0]?.message?.content;
  if(typeof text==='string'&&!result.response?.choices?.[0]?.message?.tool_calls?.length)
   modelFinal=text;
  return result.response;
 };
 try{
  reply=await runWechatAgentLoop({
   messages:[{role:'system',content:BENCHMARK_SYSTEM},{role:'user',content:item.message}],
   tools:wechatTools,
   complete:({messages,tools})=>complete({messages,tools},1200),
   finalize:({messages})=>complete({messages,tools:undefined},360),
   execute:async call=>{
    const checked=validateBenchmarkTool(item,call,wechatTools,calls);
    calls.push({name:checked.name,args:checked.args});
    log('tool_call',{...caseContext,toolNames:[checked.name],arguments:JSON.stringify(checked.args),status:checked.issue?'REJECTED_'+checked.issue:'SYNTHETIC_OBSERVATION'});
    if(checked.issue){issues.push(checked.issue);return {content:'测试工具调用被拒绝，未执行真实写入。',committed:false,halt:true}}
    return {content:syntheticObservation(checked.name),committed:/^(create_|update_|delete_|restore_)/.test(checked.name)};
   }
  });
 }catch(e){error=e instanceof Error?e.message:'UNKNOWN_ERROR'}
 const score=scoreModelCase(item,{calls,issues,reply,error});
 if(modelProvider==='openrouter'&&effectiveReasoning==='off'&&!reasoningFallbackUsed&&usage.reasoningTokens!==null&&usage.reasoningTokens>0)score.issues.push('REASONING_TOKENS_NONZERO');
 if(item.id!=='negated-save'&&calls.length&&(!modelFinal||modelFinal.trim()===''))score.issues.push('NO_NATURAL_MODEL_FINAL');
 score.passed=score.issues.length===0;
 const errorCode=error?String(error).replace(/[^A-Z0-9_]/gi,'').slice(0,42):null;
 const taskResult={caseId:item.id,name:item.name,iteration,passed:score.passed,issues:score.issues,
  tools:calls.map(x=>x.name),toolCalls:calls.map(x=>({name:x.name,args:x.args})),modelRequests,
  latencyMs:Date.now()-started,usage,reasoningFallbackUsed,requestedProvider,servedProvider,
  finalReplyPresent:!!modelFinal?.trim(),
  finalReplyPreview:safeBenchPreview(modelFinal||reply,320),errorCode};
 log('scenario_complete',{...caseContext,passed:taskResult.passed,modelRequests,latencyMs:taskResult.latencyMs,
  toolNames:taskResult.tools,usage,issues:taskResult.issues,answer:taskResult.finalReplyPreview,
  reasoningFallbackUsed,requestedProvider,servedProvider,
  ...(errorCode?{status:benchmarkFailureKind(errorCode)}:{})});
 return taskResult;
}
const models=[];let blocked=false;
for(const id of selected){
 if(blocked)break;
 const tasks=[];
 for(let repeat=0;repeat<repetitions;repeat++){
  for(const item of MODEL_BENCH_CASES){
   const result=await evaluate(id,item,repeat+1);tasks.push(result);
   if(result.errorCode&&isFatalBenchmarkError(result.errorCode)){
    blocked=true;
    console.error(diagnosticEvent('benchmark_blocked',{provider:id,caseId:item.id,category:benchmarkFailureKind(result.errorCode),
     status:'Stopped remaining scenarios and models; fix access before paid comparison.'}));
    break;
   }
   if(result.errorCode&&/BUDGET|REQUEST_LIMIT/.test(result.errorCode))break;
  }
  if(blocked||tasks.some(x=>x.errorCode&&/BUDGET|REQUEST_LIMIT/.test(x.errorCode)))break;
 }
 const model=id==='workers-ai'?DEFAULT_QWEN_MODEL:openRouterModel;
 const fatal=tasks.find(x=>x.errorCode&&isFatalBenchmarkError(x.errorCode));
 models.push({provider:id,model,reasoningRequested:id==='workers-ai'?'off':effectiveReasoning,
  status:fatal?'BLOCKED_'+benchmarkFailureKind(fatal.errorCode):'COMPLETED',
  preferredProvider:id==='openrouter'&&openRouterModel===DEEPSEEK_V41_FLASH?'relace':null,
  summary:aggregateBenchmark(tasks),results:tasks});
}
const report={benchmark:'babymemo-model-parity-v1',timestamp:new Date().toISOString(),
 setup:{tasksPerModel:MODEL_BENCH_CASES.length,repetitions,identicalPromptsSchemasObservationsScoring:true,
  providerProductionTemperatures:{'workers-ai':1,'openrouter':0},
  requestedReasoning:{'workers-ai':'off',openrouter:effectiveReasoning},
  sideEffects:'synthetic only; productionWrites=0',softLimits:{neurons:maxNeurons,usd:maxUSD}},
 results:models};
const output=JSON.stringify(report,null,2);
console.log(output);
if(process.env.MODEL_BENCH_REPORT_FILE)await writeFile(process.env.MODEL_BENCH_REPORT_FILE,output+'\n','utf8');
if(process.env.GITHUB_STEP_SUMMARY)
 await writeFile(process.env.GITHUB_STEP_SUMMARY,benchmarkMarkdownReport(models,{repetitions}),{flag:'a'});
console.log(diagnosticEvent('benchmark_finish',{status:blocked?'BLOCKED':'COMPLETED',modelRequests:spent.requests,neurons:spent.neurons,reportedUSD:spent.usd}));

// A scored miss is a benchmark result, not a CI failure; security/credential
// errors and unexpected fatal errors still fail the workflow.
if(blocked||models.some(x=>x.results.some(r=>r.errorCode&&/BUDGET|HTTP|CREDENTIAL|REQUEST_LIMIT/.test(r.errorCode))))process.exitCode=2;
