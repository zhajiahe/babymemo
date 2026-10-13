#!/usr/bin/env node
/**
 * MANUAL ONLY: this test makes one REAL, potentially billable OpenRouter call.
 * It does NOT access family data, Cloudflare D1/R2 or WeChat.
 */
import assert from 'node:assert/strict';
import {DEFAULT_OPENROUTER_MODEL} from '../src/openrouter-model.mjs';
import {wechatTools} from '../src/wechat-harness.mjs';
import {openRouterCompletion} from '../src/openrouter-retry.mjs';

async function main(){
  if(process.env.OPENROUTER_E2E_CONFIRM!=='YES')
    throw Error('MANUAL_CONFIRMATION_REQUIRED: set OPENROUTER_E2E_CONFIRM=YES');
  const key=process.env.OPENROUTER_API_KEY;
  if(!key||!key.startsWith('sk-or-'))
    throw Error('OPENROUTER_API_KEY_MISSING: configure a GitHub Secret or local environment');
  const response=await openRouterCompletion({
    key,model:DEFAULT_OPENROUTER_MODEL,
    messages:[
      {role:'system',content:'你是 BabyMemo 成长记录工具路由器。只使用提供的工具选择一个操作，不能编造数据库查询结果或猜测时间。'},
      {role:'user',content:'请查询测试宝宝最近五条成长测量记录。'}
    ],
    // This checks the provider's tool-call *contract*, not autonomous routing accuracy.
    tools:wechatTools.filter(x=>x.function.name==='list_growth'),
    tool_choice:{type:'function',function:{name:'list_growth'}},
    max_tokens:1200,
    maxAttempts:1 // Do not silently retry potentially billable requests.
  });
  const calls=response?.choices?.[0]?.message?.tool_calls;
  if(!Array.isArray(calls)||calls.length===0){
    // Never log model text, response bodies, credentials or request headers.
    const reason=String(response?.choices?.[0]?.finish_reason||'unknown').replace(/[^a-z_]/gi,'').slice(0,32);
    throw Error('MODEL_TOOL_CALLS_MISSING_FINISH_'+reason);
  }
  assert.equal(calls.length,1,'MODEL_EXPECTED_ONE_TOOL_CALL');
  assert.equal(calls[0]?.type,'function','MODEL_INVALID_TOOL_TYPE');
  assert.equal(calls[0]?.function?.name,'list_growth','MODEL_WRONG_TOOL_SELECTION');
  assert.equal(typeof calls[0]?.function?.arguments,'string','MODEL_ARGUMENTS_NOT_JSON');
  const args=JSON.parse(calls[0].function.arguments);
  assert.ok(args!==null&&typeof args==='object'&&!Array.isArray(args),'MODEL_INVALID_ARGUMENT_OBJECT');
  assert.ok(Object.keys(args).every(k=>k==='limit'),'MODEL_HALLUCINATED_QUERY_FILTER');
  assert.ok(args.limit===undefined||args.limit===5,'MODEL_WRONG_QUERY_LIMIT');
  console.log('PASS: OpenRouter forced tool-call contract with synthetic input ('+DEFAULT_OPENROUTER_MODEL+')');
}
main().catch(error=>{
  // Never log provider responses, request headers, input data or API keys.
  const msg=error instanceof Error?error.message:'UNKNOWN_ERROR';
  const safe=/^(?:OPENROUTER_|MODEL_|MANUAL_)/.test(msg)?msg:'UNEXPECTED_TEST_FAILURE';
  console.error('OpenRouter live E2E failed: '+safe);
  process.exitCode=1;
});
