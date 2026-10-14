import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterMs,openRouterCompletion,friendlyOpenRouterError,openRouterReasoningForModel,DEEPSEEK_V41_FLASH} from '../src/openrouter-retry.mjs';
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
