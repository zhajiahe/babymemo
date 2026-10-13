import test from 'node:test';
import assert from 'node:assert/strict';
import {getActiveThread,appendTurn,buildCommandContext,isClearContext,recordQuery,CONTEXT_TTL_MS} from '../src/wechat-memory.mjs';
test('bounded memory is scoped to the paired user and expires',()=>{
 let t=getActiveThread(null,'b','u',1000);
 for(let i=0;i<6;i++)t=appendTurn(t,'observation '+i,'reply '+i,'babyA',1000+i);
 assert.equal(t.turns.length,4);
 assert.equal(getActiveThread(t,'otherbot','u',2000).turns.length,0);
 assert.equal(getActiveThread(t,'b','otheruser',2000).turns.length,0);
 assert.equal(getActiveThread(t,'b','u',2000).turns.length,4);
 assert.equal(getActiveThread(t,'b','u',1006+CONTEXT_TTL_MS).turns.length,0);
 assert.equal(isClearContext('清除上下文'),true);
});
test('the model receives raw dialogue for spoken confirmation, without an injected instruction',()=>{
 const at=Date.parse('2026-10-13T18:50:00+08:00');
 let t=getActiveThread(null,'bot','user',at);
 t=appendTurn(t,'上周六第一次睡拼接床，尺寸刚好','要帮你记成 10 月 10 日那天的成长事件吗？','babyA',at);
 const x=buildCommandContext('可以可以。',t,at+1000,'babyA');
 assert.deepEqual(x.modelMessages,[
  {role:'user',content:'上周六第一次睡拼接床，尺寸刚好'},
  {role:'assistant',content:'要帮你记成 10 月 10 日那天的成长事件吗？'},
  {role:'user',content:'可以可以。'}
 ]);
 assert.equal(x.groundedText,'可以可以。');
 assert.equal(x.milestoneGroundedText,null);
});
test('all follow-ups use one shared dialogue mechanism',()=>{
 const at=Date.parse('2026-10-13T18:50:00+08:00');
 let t=getActiveThread(null,'bot','user',at);
 t=appendTurn(t,'宝宝昨天量身高了','嗯，告诉我具体数值吧','babyA',at);
 t=appendTurn(t,'85厘米','需要我保存吗？','babyA',at+1000);
 for(const text of ['好','嗯嗯','帮我记一下','不用保存','改第一条','10月10号'])
  assert.deepEqual(buildCommandContext(text,t,at+2000,'babyA').modelMessages.at(-1),{role:'user',content:text});
});
test('different babies never share conversation history',()=>{
 const at=Date.parse('2026-10-13T18:50:00+08:00');
 let t=getActiveThread(null,'bot','user',at);
 t=appendTurn(t,'宝宝A 体重 10kg','已记录','babyA',at);
 t=appendTurn(t,'宝宝B 去公园玩','听起来很开心','babyB',at+1);
 const b=buildCommandContext('记下来',t,at+2,'babyB');
 assert.equal(b.modelMessages.length,3);
 assert.doesNotMatch(JSON.stringify(b.modelMessages),/宝宝A/);
 const a=buildCommandContext('继续',t,at+2,'babyA');
 assert.doesNotMatch(JSON.stringify(a.modelMessages),/宝宝B/);
});
test('structured IDs stay scoped, never injected as fictitious user instructions',()=>{
 const at=Date.now(),t=getActiveThread(null,'bot','user',at);
 recordQuery(t,'babyA','growth',['aaaaaaaa','bbbbbbbb'],at,'msg1');
 assert.deepEqual(t.lastQuery.ids,['aaaaaaaa','bbbbbbbb']);
 assert.equal(t.lastQuery.babyId,'babyA');
 assert.deepEqual(buildCommandContext('改第一条',t,at+1,'babyA').modelMessages,[{role:'user',content:'改第一条'}]);
});
