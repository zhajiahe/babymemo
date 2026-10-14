import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterMs,openRouterCompletion,friendlyOpenRouterError,openRouterReasoningForModel,openRouterProviderForModel,DEEPSEEK_V41_FLASH} from '../src/openrouter-retry.mjs';
import {DEFAULT_OPENROUTER_MODEL,LEGACY_MUSE_MODEL,GPT_6_LUNA,CLAUDE_HAIKU_55,OPENROUTER_MODEL_PRESETS,openRouterModelDescription} from '../src/openrouter-model.mjs';
const opts=(fetchImpl,sleep)=>({key:'test',model:'test',messages:[{role:'user',content:'test'}],fetchImpl,sleep,random:()=>0});
test('honors Retry-After seconds for 429 then succeeds without repeating tool execution',async()=>{
 const sleeps=[];let attempts=0;
 const answer=await openRouterCompletion(opts(async()=>{attempts++;return attempts===1?
  new Response('',{status:429,headers:{'Retry-After':'2'}}):
  Response.json({choices:[{message:{tool_calls:[]}}]})},async ms=>sleeps.push(ms)));
 assert.equal(attempts,2);assert.deepEqual(sleeps,[2000]);assert.equal(answer.choices.length,1);
});
test('date retry after works and long 429 is surfaced without sleeping',async()=>{
 assert.equal(retryAfterMs('3'),3000);
 assert.equal(retryAfterMs(new Date(123456).toUTCString(),123000),0); // within same second
 let waited=false;
 await assert.rejects(openRouterCompletion({...opts(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}),async()=>{waited=true}),maxAttempts:3}),/OPENROUTER_RATE_LIMITED/);
 assert.equal(waited,false);
 assert.match(friendlyOpenRouterError(Error('OPENROUTER_RATE_LIMITED')),/429/);
});
test('500 is not retried; transient 503 and network errors get bounded retries',async()=>{
 let calls=0;
 await assert.rejects(openRouterCompletion(opts(async()=>{calls++;return new Response('fail',{status:500})},async()=>{})),/OPENROUTER_HTTP_500/);
 assert.equal(calls,1);
 let x=0;
 const value=await openRouterCompletion(opts(async()=>{x++;if(x===1)throw Error('network');if(x===2)return new Response('',{status:503});return Response.json({ok:true})},async()=>{}));
 assert.equal(value.ok,true);assert.equal(x,3);
});
test('non-retryable 401/402 are returned immediately',async()=>{
 for(const code of [401,402]){
  let tries=0;
  await assert.rejects(openRouterCompletion(opts(async()=>{tries++;return new Response('',{status:code})},async()=>{})),new RegExp('OPENROUTER_HTTP_'+code));
  assert.equal(tries,1);
 }
});

test('explicit named tool choice reaches the provider without changing auto defaults',async()=>{
 const tool={type:'function',function:{name:'list_growth',parameters:{type:'object',properties:{limit:{type:'integer'}}}}};
 const requests=[];
 const stub=async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({choices:[{message:{tool_calls:[]}}]})};
 await openRouterCompletion({...opts(stub,async()=>{}),tools:[tool]});
 await openRouterCompletion({...opts(stub,async()=>{}),tools:[tool],tool_choice:{type:'function',function:{name:'list_growth'}}});
 assert.equal(requests[0].tool_choice,'auto');
 assert.deepEqual(requests[1].tool_choice,{type:'function',function:{name:'list_growth'}});
 assert.equal(requests[1].tools.length,1);
});

test('DeepSeek V4.1 Flash disables reasoning while Muse retains its original request',async()=>{
 const reqs=[];
 const stub=async(_url,opts)=>{reqs.push(JSON.parse(opts.body));return Response.json({choices:[{message:{content:'OK'}}]})};
 await openRouterCompletion({...opts(stub,async()=>{}),model:DEEPSEEK_V41_FLASH});
 await openRouterCompletion({...opts(stub,async()=>{}),model:'meta/muse-spark-1.3-contributor'});
 assert.deepEqual(reqs[0].reasoning,{enabled:false});
 assert.equal('reasoning' in reqs[1],false);
 assert.equal(openRouterReasoningForModel(DEEPSEEK_V41_FLASH,'off').enabled,false);
 assert.deepEqual(openRouterReasoningForModel(DEEPSEEK_V41_FLASH,'low'),{enabled:true,effort:'low'});
 assert.throws(()=>openRouterReasoningForModel(DEEPSEEK_V41_FLASH,'invalid'),/INVALID_REASONING_MODE/);
});

test('DeepSeek Flash routes exclusively through Relace with thinking disabled',async()=>{
 const req=[];
 await openRouterCompletion({...opts(async(_u,init)=>{req.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'ok'}}]})},async()=>{}),model:DEEPSEEK_V41_FLASH});
 assert.deepEqual(req[0].provider,{only:['relace'],allow_fallbacks:false});
 assert.deepEqual(req[0].reasoning,{enabled:false});
 assert.deepEqual(openRouterProviderForModel(DEEPSEEK_V41_FLASH),{only:['relace'],allow_fallbacks:false});
 assert.equal(openRouterProviderForModel(GPT_6_LUNA),null);
});
test('GPT-6 Luna and Claude Haiku 5.5 prefer reasoning disabled and are selectable presets',async()=>{
 const req=[];
 for(const model of [GPT_6_LUNA,CLAUDE_HAIKU_55]){
  await openRouterCompletion({...opts(async(_u,init)=>{req.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'ok'}}]})},async()=>{}),model});
 }
 for(const q of req){assert.deepEqual(q.reasoning,{enabled:false});assert.equal('provider' in q,false)}
 assert.deepEqual(openRouterReasoningForModel(GPT_6_LUNA,'low'),{enabled:true,effort:'minimal'});
 assert.deepEqual(openRouterReasoningForModel(CLAUDE_HAIKU_55,'low'),{enabled:true,effort:'low'});
 for(const model of [GPT_6_LUNA,CLAUDE_HAIKU_55,DEEPSEEK_V41_FLASH]){
  assert.ok(OPENROUTER_MODEL_PRESETS.some(x=>x.id===model));
  assert.match(openRouterModelDescription(model),/思考|minimal|low/);
 }
});
test('Explicit unsupported-reasoning error permits one safe fallback to lowest effort',async()=>{
 for(const [model,lowest] of [[GPT_6_LUNA,'minimal'],[CLAUDE_HAIKU_55,'low']]){
  let count=0;const requests=[];
  const fetchImpl=async(_url,init)=>{
   count++;requests.push(JSON.parse(init.body));
   if(count===1)return Response.json({error:{message:'Disabling reasoning is not supported for this model'}},{status:400});
   return Response.json({choices:[{message:{content:'ok'}}]});
  };
  const answer=await openRouterCompletion({...opts(fetchImpl,async()=>{}),model,maxAttempts:1});
  assert.equal(count,2,'exactly one compatibility retry');
  assert.deepEqual(requests[0].reasoning,{enabled:false});
  assert.deepEqual(requests[1].reasoning,{enabled:true,effort:lowest});
  assert.equal(answer._babymemo_request.reasoningFallbackUsed,true);
  assert.deepEqual(answer._babymemo_request.reasoningRequested,{enabled:true,effort:lowest});
 }
});
test('Unrelated 400 never retries; repeated reasoning 400 stops after guarded fallback',async()=>{
 let calls=0;
 const unrelated=async()=>{calls++;return Response.json({error:{message:'Invalid tool name'}} ,{status:400})};
 await assert.rejects(openRouterCompletion({...opts(unrelated,async()=>{}),model:GPT_6_LUNA}),/OPENROUTER_HTTP_400/);
 assert.equal(calls,1);
 calls=0;
 const badReasoning=async()=>{calls++;return Response.json({error:{message:'Reasoning mode not supported'}},{status:400})};
 await assert.rejects(openRouterCompletion({...opts(badReasoning,async()=>{}),model:GPT_6_LUNA,maxAttempts:1}),/OPENROUTER_HTTP_400/);
 assert.equal(calls,2);
});

test('default OpenRouter model is DeepSeek Flash via Relace with thinking disabled',async()=>{
 assert.equal(DEFAULT_OPENROUTER_MODEL,DEEPSEEK_V41_FLASH);
 assert.equal(OPENROUTER_MODEL_PRESETS[0].id,DEFAULT_OPENROUTER_MODEL);
 assert.deepEqual(openRouterProviderForModel(DEFAULT_OPENROUTER_MODEL),{only:['relace'],allow_fallbacks:false});
 assert.deepEqual(openRouterReasoningForModel(DEFAULT_OPENROUTER_MODEL),{enabled:false});
 const calls=[];
 const result=await openRouterCompletion({
  ...opts(async(_url,init)=>{calls.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'OK'}}]})},async()=>{}),
  model:DEFAULT_OPENROUTER_MODEL,
 });
 assert.equal(calls.length,1);
 assert.equal(calls[0].model,DEEPSEEK_V41_FLASH);
 assert.deepEqual(calls[0].reasoning,{enabled:false});
 assert.deepEqual(calls[0].provider,{only:['relace'],allow_fallbacks:false});
 assert.equal(result._babymemo_request.reasoningFallbackUsed,false);
 assert.ok(OPENROUTER_MODEL_PRESETS.some(x=>x.id===LEGACY_MUSE_MODEL),'Muse must remain manually selectable');
 assert.equal(openRouterReasoningForModel(LEGACY_MUSE_MODEL),null);
});

test('benchmark explicit off requests reasoning disabled on arbitrary OpenRouter models',async()=>{
 const requests=[];let count=0;
 const response=await openRouterCompletion({...opts(async(_url,init)=>{
  count++;requests.push(JSON.parse(init.body));
  return count===1?Response.json({error:{message:'Reasoning cannot be disabled for this model'}},{status:400}):
   Response.json({choices:[{message:{content:'OK'}}]});
 },async()=>{}),model:'other/custom-model',reasoningMode:'off',maxAttempts:1});
 assert.equal(count,2);
 assert.deepEqual(requests[0].reasoning,{enabled:false});
 assert.deepEqual(requests[1].reasoning,{enabled:true,effort:'low'});
 assert.equal(response._babymemo_request.reasoningFallbackUsed,true);
});
test('unrelated 400 with explicit off never triggers low compatibility retry',async()=>{
 let count=0;
 await assert.rejects(openRouterCompletion({...opts(async()=>{
  count++;return Response.json({error:{message:'Invalid tools schema'}},{status:400});
 },async()=>{}),model:'other/custom-model',reasoningMode:'off',maxAttempts:1}),/OPENROUTER_HTTP_400/);
 assert.equal(count,1);
});
