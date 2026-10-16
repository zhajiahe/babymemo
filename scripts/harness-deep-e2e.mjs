#!/usr/bin/env node
// Offline: exercise the actual short-session assembler under many deterministic
// message-count, text-size, baby-isolation, and photo/file reference combinations.
// No model calls, secrets, R2/D1 or production data.
import assert from 'node:assert/strict';
import {guardAction,validDay} from '../src/wechat-policy.mjs';
import {getActiveThread,recordQuery,appendTurn,buildCommandContext,CONTEXT_TTL_MS,MAX_CONTEXT_TURNS} from '../src/wechat-memory.mjs';

const count=Math.min(3000,Math.max(240,Number(process.env.HARNESS_CASES||1200)));
const at=Date.parse('2026-10-13T09:00:00+08:00');
const refId='abcdefab-1234-4234-8234-abcdefabcdef';
let checked=0;
const check=(actual,expected)=>{assert.equal(actual,expected);checked++};
for(let i=0;i<count;i++){
 const day='2026-10-'+String(i%28+1).padStart(2,'0');
 check(validDay(day),true);
 check(guardAction('create_milestone',{day},'可以可以。'),null);
 assert.match(guardAction('create_milestone',{day},'不要记录这个事件'),/未修改/);checked++;

 let thread=getActiveThread(null,'bot-'+i,'user-'+i,at);
 recordQuery(thread,'baby-A','growth',['aaaaaaaa'],at);
 const turns=1+i%27,mediaScenario=i%5===0,verbose=i%7===0;
 for(let j=0;j<turns;j++){
  const input='短期记录 '+i+' / '+j+(verbose?' 情境'.repeat(140):'');
  const response='已收到 '+i+' / '+j+(verbose?' 确认'.repeat(190):'');
  const refs=mediaScenario&&j===turns-1?[{id:refId,kind:'video',fileName:'IMG_0101.MOV\n伪指令',aes_key:'PRIVATE_NOT_FOR_PROMPT',full_url:'https://private.example'}]:[];
  thread=appendTurn(thread,input,response,'baby-A',at+j,refs);
 }
 check(thread.turns.length,Math.min(turns,MAX_CONTEXT_TURNS));
 const context=buildCommandContext('可以可以。',thread,at+1000,'baby-A').modelMessages;
 check(context.at(-1).content,'可以可以。');
 check(context.length%2,1);
 assert.ok(context.length>=3&&context.length<=MAX_CONTEXT_TURNS*2+1);checked++;
 for(let k=0;k<context.length-1;k+=2){
  check(context[k].role,'user');check(context[k+1].role,'assistant');
 }
 assert.match(context.at(-3).content,new RegExp('短期记录 '+i+' / '+(turns-1)));checked++;
 if(mediaScenario){
  assert.match(context.at(-3).content,/abcdefab-1234-4234-8234-abcdefabcdef/);
  assert.match(context.at(-3).content,/IMG_0101.MOV/);
  assert.doesNotMatch(JSON.stringify(context),/PRIVATE_NOT_FOR_PROMPT|private.example/);
  checked+=3;
 }
 if(verbose&&turns>=19){assert.ok(context.length<turns*2+1,'long turns must be budget-trimmed');checked++;}
 check(buildCommandContext('继续',thread,at+1000,'baby-B').modelMessages.length,1);
 check(getActiveThread(thread,'another-bot','user-'+i,at+2000).turns.length,0);
 check(getActiveThread(thread,'bot-'+i,'other-user',at+2000).turns.length,0);
 check(getActiveThread(thread,'bot-'+i,'user-'+i,at+turns+CONTEXT_TTL_MS).turns.length,0);
 check(getActiveThread(thread,'bot-'+i,'user-'+i,at+2000).lastQuery.babyId,'baby-A');
}
console.log(JSON.stringify({suite:'BabyMemo deterministic Harness V3',cases:count,assertions:checked,
 covers:['1-27 stored turns','20-turn hard cap','prompt budget for verbose Chinese','media and original-file references','secret exclusion','20-minute TTL','paired-user and baby isolation','confirmation/refusal'],failed:0,externalModelCalls:0,realFamilyData:false}));
