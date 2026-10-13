import assert from 'node:assert/strict';
import test from 'node:test';
import {runWechatAgentLoop,DEFAULT_AGENT_LIMITS} from '../src/wechat-agent-loop.mjs';

const call=(id,name,args={})=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const reply=(...tools)=>({choices:[{message:{role:'assistant',content:null,tool_calls:tools}}]});
const done=(content='已处理')=>({choices:[{message:{role:'assistant',content,tool_calls:[]}}]});
const args={messages:[{role:'user',content:'更正昨天的体重'}],tools:[{type:'function',function:{name:'list_growth'}}]};

test('ReAct observes real tool result then decides next tool and ends',async()=>{
 const seen=[],executed=[];
 const responses=[reply(call('c1','list_growth',{day:'2026-10-12'})),reply(call('c2','update_growth',{id:'abcdef12',weight:10.2})),done('已经修改')];
 const result=await runWechatAgentLoop({...args,complete:async({messages})=>{seen.push(structuredClone(messages));return responses.shift()},
  execute:async(c,offset)=>{executed.push([c.function.name,offset]);return offset===0?'abcdef12 · 2026-10-12 · 10kg':'已更新体重（编号 abcdef12）。'}});
 assert.deepEqual(executed,[['list_growth',0],['update_growth',1]]);
 assert.equal(seen.length,3);
 assert.equal(seen[1].at(-1).role,'tool');
 assert.equal(seen[1].at(-1).tool_call_id,'c1');
 assert.match(seen[1].at(-1).content,/abcdef12/);
 assert.deepEqual(seen[2].slice(-2).map(x=>x.role),['assistant','tool']);
 assert.match(result,/已更新体重/);
 assert.doesNotMatch(result,/已经修改/); // Model prose is never evidence of writes.
});
test('all calls in one turn execute sequentially with globally unique offsets',async()=>{
 const indexes=[];
 const result=await runWechatAgentLoop({...args,complete:async()=>reply(call('a','get_runtime_context'),call('b','list_babies'),call('c','list_growth')),
  execute:async(c,i)=>{indexes.push(i);return c.function.name},limits:{rounds:1,tools:8,perRound:4,deadlineMs:60000}});
 assert.deepEqual(indexes,[0,1,2]);assert.match(result,/list_growth/);
});
test('write-ahead decision barrier prevents tools on failed journal',async()=>{
 let tools=0;
 await assert.rejects(()=>runWechatAgentLoop({...args,complete:async()=>reply(call('x','create_growth')),
  saveDecision:async()=>{throw Error('D1 unavailable')},execute:async()=>{tools++}}),/D1 unavailable/);
 assert.equal(tools,0);
});
test('replaying stored decisions does not call model or change step order',async()=>{
 const journal=new Map(),offsets=[],models=[];
 const options={...args,
  complete:async({round})=>{models.push(round);return round===0?reply(call('x','create_growth',{weight:10})):done()},
  loadDecision:async round=>journal.get(round)||null,saveDecision:async(round,a)=>{journal.set(round,a)},
  execute:async(c,offset)=>{offsets.push(offset);return '已保存体重';}};
 const first=await runWechatAgentLoop(options),second=await runWechatAgentLoop(options);
 assert.equal(first,second);assert.deepEqual(models,[0,1]);assert.deepEqual(offsets,[0,0]);
});
test('model failure after a tool exposes completed work and no false rollback',async()=>{
 let round=0;
 const r=await runWechatAgentLoop({...args,complete:async()=>{if(round++===0)return reply(call('x','create_growth'));throw Error('429')},
  execute:async()=> '已保存体重'});
 assert.match(r,/已保存体重/);assert.match(r,/后续模型调用失败/);
});
test('tool batch larger than total budget does not partially execute',async()=>{
 let writes=0;
 const r=await runWechatAgentLoop({...args,
  complete:async()=>reply(call('a','create_growth'),call('b','create_growth')),
  execute:async()=>{writes++;return '已保存';},limits:{rounds:4,tools:1,perRound:4,deadlineMs:60000}});
 assert.equal(writes,0);assert.match(r,/上限/);
});
test('tool batches above per-turn limit are refused before write',async()=>{
 let writes=0;const many=Array.from({length:5},(_,i)=>call('id-'+i,'create_growth'));
 await assert.rejects(()=>runWechatAgentLoop({...args,complete:async()=>reply(...many),
  execute:async()=>{writes++}}),/AGENT_TOO_MANY_PARALLEL_TOOLS/);
 assert.equal(writes,0);
});
test('a hallucinated success message without a tool never counts as a write',async()=>{
 const r=await runWechatAgentLoop({...args,complete:async()=>done('已保存宝宝记录'),execute:async()=>{throw Error('should not call')}});
 assert.match(r,/未修改数据/);
});
test('time cap cannot dispatch a write after timeout',async()=>{
 let clock=0,writes=0;
 const r=await runWechatAgentLoop({...args,now:()=>{clock+=100;return clock},
  complete:async()=>done('unused'),execute:async()=>{writes++},limits:{rounds:4,tools:8,perRound:4,deadlineMs:50}});
 assert.equal(writes,0);assert.match(r,/时间上限/);
});
test('duplicate tool-call ids are invalid and never executed',async()=>{
 let called=false;
 await assert.rejects(()=>runWechatAgentLoop({...args,complete:async()=>reply(call('id','list_growth'),call('id','delete_growth')),
  execute:async()=>{called=true}}),/AGENT_INVALID_TOOL_CALL/);
 assert.equal(called,false);
});
test('default budgets remain small enough for a Cloudflare alarm run',()=> {
 assert.ok(DEFAULT_AGENT_LIMITS.rounds<=4);assert.ok(DEFAULT_AGENT_LIMITS.tools<=8);
});

test('rejected mutating tool halts remaining calls and future rounds',async()=>{
 let executed=0,completions=0;
 const r=await runWechatAgentLoop({...args,
  complete:async()=>{completions++;return reply(call('first','delete_growth'),call('second','create_growth'))},
  execute:async()=>{executed++;return {content:'目标不唯一，未删除',halt:true}}});
 assert.equal(executed,1);assert.equal(completions,1);
 assert.match(r,/未删除/);
});
