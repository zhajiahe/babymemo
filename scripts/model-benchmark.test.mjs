import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatTools} from '../src/wechat-harness.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
import {MODEL_BENCH_CASES,BENCHMARK_SYSTEM,syntheticObservation,validateBenchmarkTool,scoreModelCase,aggregateBenchmark} from './model-benchmark-cases.mjs';

const call=(name,args={})=>({id:'fixture_'+name,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('both providers share exactly ten synthetic BabyMemo tasks',()=>{
 assert.equal(MODEL_BENCH_CASES.length,10);
 assert.ok(BENCHMARK_SYSTEM.includes('不要反复调用'));
 assert.ok(MODEL_BENCH_CASES.every(x=>x.id&&x.message));
 assert.equal(new Set(MODEL_BENCH_CASES.map(x=>x.id)).size,10);
 assert.equal(MODEL_BENCH_CASES.filter(x=>x.forbidWrites).length,5);
});
test('correct read and update order plus grounded target passes',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-update'),calls=[];
 for(const x of [call('list_growth',{day:'2026-10-13'}),call('update_growth',{id:'aaaaaaaa',weight:10.2})]){
  const v=validateBenchmarkTool(item,x,wechatTools,calls);
  assert.equal(v.issue,null);calls.push({name:v.name,args:v.args});
 }
 assert.deepEqual(scoreModelCase(item,{calls,reply:'已经将昨天体重更正为10.2kg。'}),{passed:true,issues:[]});
 assert.equal(scoreModelCase(item,{calls:[...calls].reverse(),reply:'已更新'}).passed,false);
});
test('unmatched mutation is blocked before observing a fake commit',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='negated-save');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{day:'2026-10-14',weight:10.5}),wechatTools).issue,'UNAUTHORIZED_MUTATION');
 assert.equal(scoreModelCase(item,{calls:[{name:'create_growth'}],reply:'已经记下'}).passed,false);
});
test('invalid shape, missing and invented parameters fail closed',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-create');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{weight:10.5}),wechatTools).issue,'MISSING_REQUIRED_ARGUMENT');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{day:'2026-10-14',weight:10.5,height:82,random:true}),wechatTools).issue,'UNRECOGNIZED_ARGUMENT');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{day:'2026-10-14',weight:10.5,height:85}),wechatTools).issue,'WRONG_HEIGHT');
});
test('duplicate tool invocations and incomplete final replies do not pass',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-read'),first={name:'list_growth',args:{limit:5}};
 assert.match(String(validateBenchmarkTool(item,call('list_growth',{limit:5}),wechatTools,[first]).issue),/REPEATED/);
 assert.equal(scoreModelCase(item,{calls:[first],reply:'已查到相关资料，但暂时没能整理成可靠的回答'}).passed,false);
});
test('benchmark tools only return synthetic data; no database or file access',()=>{
 assert.match(syntheticObservation('list_trash'),/eeeeeeee/);
 assert.match(syntheticObservation('update_growth'),/已更新/);
});
test('unknown provider usage is reported as unknown rather than free',()=>{
 const s=aggregateBenchmark([
  {passed:true,modelRequests:2,usage:{inputTokens:100,outputTokens:20,neurons:1,reportedUSD:null}},
  {passed:false,modelRequests:1,usage:{inputTokens:200,outputTokens:30,neurons:2,reportedUSD:null}}
 ]);
 assert.equal(s.passed,1);assert.equal(s.modelRequests,3);assert.equal(s.usage.neurons,3);assert.equal(s.usage.reportedUSD,null);
});
test('real ReAct loop synthetic read still needs a natural final answer',async()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-read');
 const calls=[],messages=[{role:'system',content:BENCHMARK_SYSTEM},{role:'user',content:item.message}];
 let n=0;
 const answer=await runWechatAgentLoop({
  messages,tools:wechatTools,
  complete:async()=>n++===0?{choices:[{message:{role:'assistant',content:null,tool_calls:[call('list_growth',{limit:5})]}}]}:
   {choices:[{message:{role:'assistant',content:'最近两次体重分别是10.5kg和10.0kg。',tool_calls:[]}}]},
  execute:async x=>{
   const v=validateBenchmarkTool(item,x,wechatTools,calls);
   assert.equal(v.issue,null);calls.push({name:v.name,args:v.args});return {content:syntheticObservation(x.function.name)};
  }
 });
 assert.match(answer,/10.5kg/);
 assert.equal(scoreModelCase(item,{calls,reply:answer}).passed,true);
});
