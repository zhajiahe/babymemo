#!/usr/bin/env node
// Manual deep evaluation: synthetic data and deterministic state transitions only.
import assert from 'node:assert/strict';
import {guardAction,explicitDay,validDay,measurementGrounded} from '../src/wechat-policy.mjs';
import {getActiveThread,recordQuery,setPending,buildCommandContext,CONTEXT_TTL_MS} from '../src/wechat-memory.mjs';
const count=Math.min(3000,Math.max(240,Number(process.env.HARNESS_CASES||1200)));
const baby={id:'synthetic-a',time_zone:'Asia/Shanghai'},at=Date.parse('2026-10-13T09:00:00+08:00');
let cases=0;
for(let i=0;i<count;i++){
 const day=(i%28+1).toString().padStart(2,'0'),date='2026-10-'+day;
 assert.equal(validDay(date),true);
 assert.equal(explicitDay('2026年10月'+Number(day)+'日',at,baby.time_zone),date);
 assert.ok(guardAction('delete_growth',{day:date},'不要删除 2026年10月'+Number(day)+'日的体重',baby,at));
 cases++;
 const weight=+(5+(i%120)/10).toFixed(1);
 assert.equal(measurementGrounded({weight},'称了 '+weight+'kg'),true);
 assert.equal(measurementGrounded({weight:weight+3},'称了 '+weight+'kg'),false);
 cases++;
 const thread=getActiveThread(null,'bot-'+i,'user-'+i,at);
 recordQuery(thread,baby.id,'growth',['aaaaaaaa'],at);
 assert.match(buildCommandContext('把第一条体重改成 10.2kg',thread,at+1000,baby.id).groundedText,/aaaaaaaa/);
 assert.doesNotMatch(buildCommandContext('把第一条体重改成 10.2kg',thread,at+1000,'baby-other').groundedText,/aaaaaaaa/);
 setPending(thread,baby.id,'create_growth','记一下体重',{},at);
 assert.equal(getActiveThread({...thread,expiresAt:at+CONTEXT_TTL_MS},'bot-'+i,'user-'+i,at+CONTEXT_TTL_MS+1).pending,null);
 cases++;
}
console.log(JSON.stringify({suite:'BabyMemo synthetic harness deep evaluation',cases,failed:0,externalModelCalls:0,realFamilyData:false}));
