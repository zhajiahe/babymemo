import test from 'node:test';
import assert from 'node:assert/strict';
import {getActiveThread,appendTurn,buildCommandContext,isClearContext,recordQuery,setPending,isMilestoneSaveFollowup,CONTEXT_TTL_MS} from '../src/wechat-memory.mjs';
test('scoped bounded memory with TTL and explicit reset',()=>{
 let thread=getActiveThread(null,'botA','userA',1000);
 for(let i=0;i<6;i++)thread=appendTurn(thread,'query '+i,'reply '+i,'baby1',1000+i);
 assert.equal(thread.turns.length,4);assert.equal(thread.babyId,'baby1');
 assert.equal(getActiveThread(thread,'botB','userA',2000).turns.length,0);
 assert.equal(getActiveThread(thread,'botA','userB',2000).turns.length,0);
 assert.equal(getActiveThread(thread,'botA','userA',2000).turns.length,4);
 assert.equal(getActiveThread(thread,'botA','userA',1006+CONTEXT_TTL_MS).turns.length,0);
 assert.equal(isClearContext('清除上下文'),true);assert.equal(isClearContext('查询小好'),false);
});
test('multi-turn first result reference resolves to previously listed ID',()=>{
 let thread=getActiveThread(null,'bot','user',1000);
 thread=appendTurn(thread,'查小好最近体重','小好的成长测量：\naaaaaaaa · 2026-10-01 · 10kg\nbbbbbbbb · 2026-09-30 · 9kg','baby',1000);
 recordQuery(thread,'baby','growth',['aaaaaaaa','bbbbbbbb'],1000);
 const c=buildCommandContext('把第一条体重改为 10.2kg',thread,1500,'baby');
 assert.match(c.modelMessages.at(-1).content,/aaaaaaaa/);assert.match(c.groundedText,/记录编号 aaaaaaaa/);
 assert.doesNotMatch(buildCommandContext('删除第三条',thread,1500,'baby').groundedText,/记录编号/);
 assert.doesNotMatch(buildCommandContext('删除别人的记录',thread,1500,'baby').groundedText,/记录编号/);
});
test('clarification continuation uses actual previous user intent, not bot as authority',()=>{
 let thread=getActiveThread(null,'bot','user',1000);
 thread=appendTurn(thread,'删除小好某天记录','请提供记录日期','baby',1000);
 const next=buildCommandContext('10月1日',thread);
 assert.match(next.groundedText,/删除小好某天记录/);
 assert.match(next.modelMessages.at(-1).content,/上一轮待补充/);
 const unrelated=buildCommandContext('查询最近记录',thread);
 assert.doesNotMatch(unrelated.groundedText,/删除/);
});

test('structured query is scoped to baby and expires; pending task state survives turns',()=>{
 let thread=getActiveThread(null,'bot','user',1000);
 recordQuery(thread,'babyA','growth',['aaaaaaaa'],1000);
 assert.doesNotMatch(buildCommandContext('改第一条',thread,1500,'babyB').groundedText,/记录编号/);
 assert.match(buildCommandContext('改第一条',thread,1500,'babyA').groundedText,/aaaaaaaa/);
 setPending(thread,'babyA','create_growth','记一下体重',{},1000);
 thread=appendTurn(thread,'记一下体重','请提供数值','babyA',1000);
 assert.equal(getActiveThread(thread,'bot','user',1500).pending.action,'create_growth');
 assert.equal(getActiveThread(thread,'bot','user',1000+CONTEXT_TTL_MS+5).pending,null);
});

test('explicit follow-up consolidates three user observations into one grounded milestone',()=>{
 const at=Date.parse('2026-10-13T15:00:00+08:00');
 let thread=getActiveThread(null,'bot','user',at);
 thread=appendTurn(thread,'小好昨晚总醒','听起来昨晚很辛苦，需要我帮你记录吗？','baby-a',at);
 thread=appendTurn(thread,'中间睡了三个小时','明白，中间连续睡了三个小时。','baby-a',at+1000);
 thread=appendTurn(thread,'后面又半小时一醒','这样听起来确实频繁。','baby-a',at+2000);
 assert.equal(isMilestoneSaveFollowup('记下来'),true);
 assert.equal(isMilestoneSaveFollowup('不要记下来'),false);
 const ctx=buildCommandContext('记下来',thread,at+3000,'baby-a');
 assert.match(ctx.milestoneGroundedText,/小好昨晚总醒[\s\S]*中间睡了三个小时[\s\S]*后面又半小时一醒[\s\S]*记下来/);
 assert.doesNotMatch(ctx.milestoneGroundedText,/听起来|明白/);
 assert.equal(ctx.groundedText,'记下来'); // only the milestone tool gets enriched grounding
 assert.match(ctx.modelMessages.at(-1).content,/create_milestone/);
});
test('diary follow-up never borrows another baby, an expired session or casual non-consent',()=>{
 const at=Date.parse('2026-10-13T15:00:00+08:00');
 let thread=getActiveThread(null,'bot','user',at);
 thread=appendTurn(thread,'宝宝A昨晚生病了','需要我记录吗？','baby-a',at);
 assert.equal(buildCommandContext('记下来',thread,at+1,'baby-b').milestoneGroundedText,null);
 assert.equal(buildCommandContext('不要记下来',thread,at+1,'baby-a').milestoneGroundedText,null);
 assert.equal(buildCommandContext('记下来',getActiveThread(thread,'bot','user',at+CONTEXT_TTL_MS+1),at+CONTEXT_TTL_MS+1,'baby-a').milestoneGroundedText,null);
});
