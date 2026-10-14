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
 assert.equal(result,'已经修改'); // Final model response is the surface; verified tool write authorizes this.
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
 assert.match(r,/没有实际保存或修改/);
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

test('natural no-tool response is preserved without making any database changes',async()=>{
 let writes=0;
 const text='小好昨晚睡得不太安稳。要不要我把这段情况记入日记？';
 const result=await runWechatAgentLoop({...args,complete:async()=>done(text),execute:async()=>{writes++}});
 assert.equal(result,text);
 assert.equal(writes,0);
});
test('no-tool claim of a completed milestone write is blocked even with a preamble',async()=>{
 for(const fake of ['好啦，我已经帮你记下来了。','已经保存到里程碑了。','这条记录保存成功。']){
  const result=await runWechatAgentLoop({...args,complete:async()=>done(fake),execute:async()=>{throw Error('unexpected write')}});
  assert.match(result,/没有实际保存或修改/);
  assert.doesNotMatch(result,/帮你记下来了|保存成功/);
 }
});
test('no-tool clarification is not replaced by a mandatory tool instruction',async()=>{
 const result=await runWechatAgentLoop({...args,complete:async()=>done('想把这段记录在昨天还是今天？'),execute:async()=>{throw Error('unexpected')}});
 assert.equal(result,'想把这段记录在昨天还是今天？');
});

test('runtime context JSON stays in model observation but is never sent to WeChat',async()=>{
 const observed=[];
 const context='{"currentTimestamp":"2026-10-13T07:21:28Z","messageLocalDay":"2026-10-13","timeZone":"Asia/Shanghai"}';
 let round=0;
 const r=await runWechatAgentLoop({...args,
  complete:async({messages})=>{observed.push(structuredClone(messages));return round++===0?reply(call('time','get_runtime_context')):done('现在是下午三点多。')},
  execute:async()=>context});
 assert.equal(r,'现在是下午三点多。');
 assert.equal(observed.length,2);
 assert.equal(observed[1].at(-1).role,'tool');
 assert.equal(observed[1].at(-1).content,context);
 assert.doesNotMatch(r,/currentTimestamp|messageLocalDay|Asia\/Shanghai|\{/);
});
test('runtime context before a real mutation does not leak even if a later step fails',async()=>{
 let round=0;
 const r=await runWechatAgentLoop({...args,
  complete:async()=>round++===0?reply(call('time','get_runtime_context')):reply(call('save','create_milestone')),
  execute:async c=>c.function.name==='get_runtime_context'?'{"currentTimestamp":"2026-10-13T07:21:28Z"}':{content:'记录日期缺乏原消息的明确依据，请补充日期。',halt:true}});
 assert.equal(r,'记录日期缺乏原消息的明确依据，请补充日期。');
 assert.doesNotMatch(r,/currentTimestamp/);
});
test('legacy no-tool boilerplate echoed by the model does not reach users',async()=>{
 const r=await runWechatAgentLoop({...args,
  complete:async()=>done('模型没有返回可执行的工具指令，未修改任何记录。请说明要查询、记录或修改的内容。'),
  execute:async()=>{throw Error('unexpected')}});
 assert.doesNotMatch(r,/没有返回可执行的工具指令/);
 assert.match(r,/没有修改记录/);
});

test('read observation is private and the assistant answers the actual age question',async()=>{
 const transcript=[];
 const query=[{role:'user',content:'我儿多大了'}];
 let turn=0;
 const replyText='小好现在一岁四个月十三天啦。';
 const r=await runWechatAgentLoop({
  messages:query,tools:args.tools,
  complete:async({messages})=>{
   transcript.push(structuredClone(messages));
   return turn++===0?reply(call('b','get_baby')):done(replyText);
  },
  execute:async()=> '小好 的档案：生日 2025-05-30 21:01，过敏和注意事项：无，备注：拉屎困难户'
 });
 assert.equal(r,replyText);
 assert.equal(transcript.length,2);
 assert.equal(transcript[1].at(-1).role,'tool');
 assert.match(transcript[1].at(-1).content,/2025-05-30/);
 assert.doesNotMatch(r,/档案|过敏|备注/);
});
test('an actual diary write authorizes a natural final reply without echoing the tool receipt',async()=>{
 const natural='记好啦，小好昨晚频繁夜醒的情况已记到昨天的日记里。';
 const r=await runWechatAgentLoop({...args,
  complete:async({round})=>round===0?reply(call('create','create_milestone',{day:'2026-10-12'})):done(natural),
  execute:async()=>({content:'已保存成长事件：12345678 · 2026-10-12 · 昨夜睡眠观察',committed:true})});
 assert.equal(r,natural);
 assert.doesNotMatch(r,/12345678/);
});
test('a read cannot authorize the model to invent a successful save',async()=>{
 const r=await runWechatAgentLoop({...args,
  complete:async({round})=>round===0?reply(call('read','get_baby')):done('我已经把小好的睡眠保存到日记啦！'),
  execute:async()=> '小好 的档案：生日 2025-05-30'});
 assert.doesNotMatch(r,/已经把|保存到日记/);
 assert.match(r,/暂时没能整理成可靠的回答/);
});
test('a failed write can be explained naturally without permitting another write',async()=>{
 let writeCount=0,finalCount=0;
 const r=await runWechatAgentLoop({...args,
  complete:async()=>reply(call('write','create_milestone')),
  execute:async()=>{writeCount++;return {content:'记录日期缺乏原消息的明确依据，请补充日期。',committed:false,halt:true}},
  finalize:async({messages})=>{
   finalCount++;
   assert.equal(messages.at(-1).role,'tool');
   return done('这次还没记进去，你想把它记在昨天还是今天？');
  }});
 assert.equal(writeCount,1);
 assert.equal(finalCount,1);
 assert.equal(r,'这次还没记进去，你想把它记在昨天还是今天？');
});
test('a failed write does not accept hallucinated success during finalization',async()=>{
 const r=await runWechatAgentLoop({...args,
  complete:async()=>reply(call('write','create_milestone')),
  execute:async()=>({content:'记录日期缺乏依据，未保存。',committed:false,halt:true}),
  finalize:async()=>done('已经成功保存到日记里啦！')});
 assert.equal(r,'记录日期缺乏依据，未保存。');
});
test('model can answer after a runtime context tool without displaying the JSON',async()=>{
 const payload='{"currentTimestamp":"2026-10-13T08:32:00Z","messageLocalTime":"16:32","timeZone":"Asia/Shanghai"}';
 const r=await runWechatAgentLoop({...args,
  complete:async({round})=>round===0?reply(call('clock','get_runtime_context')):done('现在是下午四点三十二分。'),
  execute:async()=>payload});
 assert.equal(r,'现在是下午四点三十二分。');
 assert.doesNotMatch(r,/currentTimestamp|timeZone/);
});

test('reading the baby profile never authorizes a fake cheerful diary acknowledgement',async()=>{
 const r=await runWechatAgentLoop({...args,
  complete:async({round})=>round===0?reply(call('a','get_baby')):done('记好啦！小好的睡眠已经记进日记了。'),
  execute:async()=> '小好 的档案：生日 2025-05-30'});
 assert.match(r,/暂时没能整理成可靠的回答/);
});
test('a no-tool cheerful acknowledgement cannot impersonate a successful write',async()=>{
 const r=await runWechatAgentLoop({...args,
  complete:async()=>done('记好啦！'),
  execute:async()=>{throw Error('unexpected')}});
 assert.match(r,/没有实际保存或修改/);
});

test('invalid final after a genuine read gets a tool-free second chance instead of raw profile',async()=>{
 let round=0,summarize=0;
 const profile='小好 的档案：生日 2025-05-30 21:01，过敏和注意事项：无，备注：拉屎困难户';
 const messages=[];
 const out=await runWechatAgentLoop({...args,
  messages:[{role:'user',content:'小好多大了'}],
  complete:async()=>round++===0?reply(call('b','get_baby')):done('操作已完成'),
  execute:async()=>profile,
  finalize:async({observations,messages:history,reason})=>{
   summarize++;messages.push(structuredClone(history));
   assert.equal(reason,'inadequate_final');
   assert.deepEqual(observations,[{name:'get_baby',content:profile}]);
   return done('小好现在 1 岁 4 个月 13 天啦。');
  }
 });
 assert.equal(out,'小好现在 1 岁 4 个月 13 天啦。');
 assert.equal(summarize,1);
 assert.equal(messages[0].at(-1).content,'操作已完成');
});
test('unhelpful model final plus unhelpful retry does not expose raw private baby profile',async()=>{
 let tries=0,round=0;
 const out=await runWechatAgentLoop({...args,
  complete:async()=>round++===0?reply(call('b','get_baby')):done('小好 的档案：生日 2025-05-30，备注：无'),
  execute:async()=> '小好 的档案：生日 2025-05-30，备注：无',
  finalize:async()=>{tries++;return done('操作已完成')}
 });
 assert.equal(tries,1);
 assert.match(out,/暂时没能整理成可靠的回答/);
 assert.doesNotMatch(out,/档案|备注|2025-05-30/);
});
test('a tool-free explanation cannot fabricate write success after an invalid read reply',async()=>{
 let summary=0;
 const out=await runWechatAgentLoop({...args,
  complete:async({round})=>round===0?reply(call('b','get_baby')):done('操作已完成'),
  execute:async()=> '小好 的档案：生日 2025-05-30',
  finalize:async()=>{summary++;return done('我已经保存到成长日记了！')}
 });
 assert.equal(summary,1);
 assert.match(out,/暂时没能整理成可靠的回答/); // no raw profile exposure
});

test('a completed tool observation has a stable cached AI final across message replay',async()=>{
 const decisionJournal=new Map(),finalJournal=new Map(),executions=[],modelRounds=[],summaries=[];
 const opts={...args,
  complete:async({round})=>{
   modelRounds.push(round);
   return round===0?reply(call('b','get_baby')):done('操作已完成');
  },
  execute:async c=>{executions.push(c.function.name);return '小好 的档案：生日 2025-05-30'},
  loadDecision:async r=>decisionJournal.get(r)||null,
  saveDecision:async(r,v)=>{decisionJournal.set(r,v)},
  loadFinalAnswer:async()=>finalJournal.get('reply')||null,
  saveFinalAnswer:async answer=>{if(finalJournal.has('reply'))throw Error('duplicated final journal');finalJournal.set('reply',answer)},
  finalize:async()=>{summaries.push(1);return done('小好从出生到今天已经 501 天啦。')}
 };
 const first=await runWechatAgentLoop(opts),second=await runWechatAgentLoop(opts);
 assert.equal(first,second);
 assert.deepEqual(modelRounds,[0,1]);
 assert.equal(summaries.length,1);
 assert.deepEqual(executions,['get_baby','get_baby']); // D1 tool journal idempotency tested in Worker
 assert.equal(finalJournal.get('reply'),first);
});

test('a paraphrased raw profile dump is not a conversational answer',async()=>{
 let tries=0;
 const res=await runWechatAgentLoop({...args,
  complete:async({round})=>round===0?reply(call('profile','get_baby')):done('小好的档案：生日 2025-05-30，过敏和注意事项：无'),
  execute:async()=> '小好 的档案：生日 2025-05-30，年龄 1 岁 4 个月 13 天，过敏和注意事项：无',
  finalize:async()=>{tries++;return done('小好现在 1 岁 4 个月啦。')}
 });
 assert.equal(tries,1);
 assert.equal(res,'小好现在 1 岁 4 个月啦。');
});

test('photo caption update cannot claim success without a committed tool',async()=>{
 const message='收到，我已把刚才那张照片的描述更新为“像是 3 岁小孩的样子，靓仔”。';
 const result=await runWechatAgentLoop({...args,complete:async()=>done(message),execute:async()=>{throw Error('unexpected write')}});
 assert.doesNotMatch(result,/描述更新为/);
 assert.match(result,/没有实际保存或修改/);
});
