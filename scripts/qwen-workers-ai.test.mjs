import assert from 'node:assert/strict';
import test from 'node:test';
import {qwenRequest,qwenCompletion,friendlyWorkersAIError,DEFAULT_QWEN_MODEL} from '../src/qwen-workers-ai.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
test('Qwen3.8 model always disables thinking while allowing tool use',()=>{
 const req=qwenRequest({messages:[{role:'user',content:'查体重'}],tools:[{type:'function',function:{name:'list_growth'}}],max_tokens:160});
 assert.equal(req.chat_template_kwargs.enable_thinking,false);
 assert.equal(req.reasoning_effort,'low');
 assert.equal(req.tool_choice,'auto');
 assert.equal(req.parallel_tool_calls,false);
 assert.equal(req.max_completion_tokens,160);
 assert.equal(req.temperature,1);
 assert.equal(req.stream,undefined);
});
test('Workers AI output interoperates with BabyMemo ReAct and journaling',async()=>{
 const actual=[],requests=[];
 const ai={run:async(model,input)=>{
  assert.equal(model,DEFAULT_QWEN_MODEL);
  requests.push(input);
  return requests.length===1?{choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'test-tool',type:'function',function:{name:'list_growth',arguments:'{"limit":5}'}}]}}]}:
   {choices:[{message:{role:'assistant',content:'查询到最近体重 10.5kg，已为你整理好。',tool_calls:[]}}]};
 }};
 const answer=await runWechatAgentLoop({
  messages:[{role:'user',content:'查询最近五次体重'}],tools:[{type:'function',function:{name:'list_growth'}}],
  complete:({messages,tools})=>qwenCompletion({ai,messages,tools}),
  saveDecision:async()=>{},
  execute:async(call)=>{actual.push(call.function.name);return '测试宝宝体重 10.5kg'}
 });
 assert.deepEqual(actual,['list_growth']);
 assert.equal(requests[1].messages.at(-1).role,'tool');
 assert.match(answer,/10.5kg/);
});
test('No binding fails clearly; never silently fabricates an answer',async()=>{
 await assert.rejects(()=>qwenCompletion({ai:null,messages:[{role:'user',content:'hi'}]}),/WORKERS_AI_BINDING_MISSING/);
 assert.match(friendlyWorkersAIError(new Error('WORKERS_AI_BINDING_MISSING')),/Binding/);
});
test('Provider errors never reveal raw upstream response to user',async()=>{
 const ai={run:async()=>{throw Error('Upstream 429: secret information')}};
 await assert.rejects(()=>qwenCompletion({ai,messages:[{role:'user',content:'hello'}]}),/WORKERS_AI_QUOTA_OR_CAPACITY/);
});
