#!/usr/bin/env node
// Model-first harness invariants; no live models or private data.
import assert from 'node:assert/strict';
import {guardAction,validDay} from '../src/wechat-policy.mjs';
import {getActiveThread,recordQuery,appendTurn,buildCommandContext,CONTEXT_TTL_MS} from '../src/wechat-memory.mjs';
const count=Math.min(3000,Math.max(240,Number(process.env.HARNESS_CASES||1200)));
let cases=0;
for(let i=0;i<count;i++){
 const n=i%28+1,day='2026-10-'+String(n).padStart(2,'0'),at=Date.parse('2026-10-13T09:00:00+08:00');
 assert.equal(validDay(day),true);
 assert.equal(guardAction('create_milestone',{day},'可以可以。'),null);
 assert.match(guardAction('create_milestone',{day},'不要记录这个事件'),/未修改/);
 cases+=2;
 let thread=getActiveThread(null,'bot-'+i,'user-'+i,at);
 recordQuery(thread,'baby-A','growth',['aaaaaaaa'],at);
 thread=appendTurn(thread,'上周六去了公园','想记下来吗？','baby-A',at);
 const ctx=buildCommandContext('可以可以。',thread,at+1000,'baby-A');
 assert.equal(ctx.modelMessages.length,3);
 assert.equal(ctx.modelMessages[0].content,'上周六去了公园');
 assert.equal(ctx.modelMessages[1].role,'assistant');
 assert.equal(ctx.modelMessages[2].content,'可以可以。');
 assert.equal(buildCommandContext('可以可以。',thread,at+1000,'baby-B').modelMessages.length,1);
 assert.equal(getActiveThread(thread,'bot-'+i,'user-'+i,at+CONTEXT_TTL_MS+1).turns.length,0);
 cases++;
}
console.log(JSON.stringify({suite:'BabyMemo synthetic model-first harness evaluation',cases,failed:0,externalModelCalls:0,realFamilyData:false}));
