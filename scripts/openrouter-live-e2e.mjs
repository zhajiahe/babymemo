#!/usr/bin/env node
/**
 * MANUAL ONLY: makes exactly one REAL, potentially billable OpenRouter call.
 *
 * This is the same AUTO tool-routing request as scenario #1 in the successful
 * Manual Harness Deep E2E live suite. Meta Muse Spark can reject a forced
 * tool_choice:{type:'function',...} with HTTP 400 even when auto tool calling
 * works. Do not use a forced tool for this model-compatibility smoke test.
 *
 * No production D1/R2, WeChat, real baby data or model response bodies.
 */
import assert from 'node:assert/strict';
import {DEFAULT_OPENROUTER_MODEL} from '../src/openrouter-model.mjs';
import {wechatTools} from '../src/wechat-harness.mjs';
import {openRouterCompletion} from '../src/openrouter-retry.mjs';

async function main(){
 if(process.env.OPENROUTER_E2E_CONFIRM!=='YES')
  throw Error('MANUAL_CONFIRMATION_REQUIRED');
 const key=process.env.OPENROUTER_API_KEY;
 if(!key||!key.startsWith('sk-or-'))throw Error('OPENROUTER_API_KEY_MISSING');
 const model=process.env.HARNESS_TEST_MODEL||DEFAULT_OPENROUTER_MODEL;
 const response=await openRouterCompletion({
  key,model,
  messages:[
   {role:'system',content:'你是 BabyMemo 受限工具路由器。当前日期 2026-10-13，宝宝为“测试宝宝”。仅调用用户明确授权的白名单工具，否定或无事实来源时不得写入。可使用多个工具；不要编造参数。'},
   {role:'user',content:'查询测试宝宝最近五条体重记录'}
  ],
  tools:wechatTools,
  tool_choice:'auto',
  max_tokens:1200,
  maxAttempts:1 // No hidden paid retries.
 });
 const calls=response?.choices?.[0]?.message?.tool_calls;
 if(!Array.isArray(calls)||calls.length===0){
  const reason=String(response?.choices?.[0]?.finish_reason||'unknown').replace(/[^a-z_]/gi,'').slice(0,32);
  throw Error('MODEL_TOOL_CALLS_MISSING_FINISH_'+reason);
 }
 assert.equal(calls.length,1,'MODEL_EXPECTED_ONE_TOOL_CALL');
 assert.equal(calls[0]?.type,'function','MODEL_INVALID_TOOL_TYPE');
 assert.equal(calls[0]?.function?.name,'list_growth','MODEL_WRONG_TOOL_SELECTION');
 assert.equal(typeof calls[0]?.function?.arguments,'string','MODEL_ARGUMENTS_NOT_JSON');
 let args;try{args=JSON.parse(calls[0].function.arguments)}catch{throw Error('MODEL_ARGUMENTS_NOT_JSON')}
 assert.ok(args!==null&&typeof args==='object'&&!Array.isArray(args),'MODEL_INVALID_ARGUMENT_OBJECT');
 assert.ok(Object.keys(args).every(k=>k==='limit'),'MODEL_HALLUCINATED_QUERY_FILTER');
 assert.ok(args.limit===undefined||args.limit===5,'MODEL_WRONG_QUERY_LIMIT');
 console.log('PASS: OpenRouter automatic read-only tool routing ('+model+'). No records were modified.');
}
main().catch(error=>{
 const msg=error instanceof Error?error.message:'UNKNOWN_ERROR';
 const safe=/^(?:OPENROUTER_|MODEL_|MANUAL_)/.test(msg)?msg:'UNEXPECTED_TEST_FAILURE';
 console.error('OpenRouter live E2E failed: '+safe);
 process.exitCode=1;
});
