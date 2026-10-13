import assert from 'node:assert/strict';
import test from 'node:test';
import {guardAction,measurementGrounded,newDayGrounded} from '../src/wechat-policy.mjs';
import {appendTurn,buildCommandContext,getActiveThread} from '../src/wechat-memory.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
import {isCommittedMutationReply,runWechatPlan} from '../src/wechat-orchestrator.mjs';

const at=Date.parse('2026-10-13T09:00:00+08:00');
const baby={id:'baby-a',name:'测试宝宝',time_zone:'Asia/Shanghai'};
const call=(name,args={})=>({type:'function',function:{name,arguments:JSON.stringify(args)}});
const response=(...tools)=>({choices:[{message:{content:null,tool_calls:tools}}]});

test('recent-media updates use server-pinned batch, not nonexistent old selectors',()=>{
 const input='把刚才发的照片日期改成昨天';
 assert.equal(guardAction('update_recent_media',{newDay:'2026-10-12'},input,baby,at),null);
 assert.ok(guardAction('update_recent_media',{newDay:'2026-10-11'},input,baby,at));
 assert.ok(guardAction('update_recent_media',{newDay:'2026-10-12'},'不要修改刚才的照片',baby,at));
});

test('old/new date roles must be distinct and the new date independently grounded',()=>{
 const change='把10月1日照片改到10月2日';
 assert.equal(guardAction('update_media',{day:'2026-10-01',newDay:'2026-10-02'},change,baby,at),null);
 assert.ok(guardAction('update_media',{day:'2026-10-01',newDay:'2026-11-02'},change,baby,at));
 assert.equal(guardAction('update_milestone',{day:'2026-10-01',newDay:'2026-10-02'},'把10月1日里程碑改到10月2日',baby,at),null);
 assert.ok(guardAction('update_milestone',{day:'2026-10-01',newDay:'2026-11-02'},'把10月1日里程碑改到10月2日',baby,at));
 assert.equal(newDayGrounded('2026-10-12','把刚才照片日期改成昨天',at,'Asia/Shanghai'),true);
});

test('the same cm measurement cannot justify two different body metrics',()=>{
 assert.equal(measurementGrounded({height:80,headCircumference:80},'测试宝宝今天身高80cm'),false);
 assert.equal(measurementGrounded({headCircumference:80},'测试宝宝今天身高80cm'),false);
 assert.equal(measurementGrounded({height:80},'测试宝宝今天头围80cm'),false);
 assert.equal(measurementGrounded({height:80},'测试宝宝今天身高80cm'),true);
 assert.equal(measurementGrounded({height:80,headCircumference:46},'身高80cm，头围46cm'),true);
 assert.equal(measurementGrounded({height:80},'测试宝宝今天80cm'),false);
 assert.equal(measurementGrounded({weight:10},'体重20斤'),true);
});

test('switching babies excludes all prior baby turns from the model transcript',()=>{
 let thread=getActiveThread(null,'bot','user',at);
 thread=appendTurn(thread,'宝宝A体重10kg','已保存宝宝A体重','baby-a',at);
 thread=appendTurn(thread,'宝宝B体重8kg','已保存宝宝B体重','baby-b',at+1);
 const context=buildCommandContext('查询最近体重',thread,at+2,'baby-b');
 const history=JSON.stringify(context.modelMessages);
 assert.doesNotMatch(history,/宝宝A/);
 assert.match(history,/宝宝B/);
});

test('a step deadline is checked between tools in the same model batch',async()=>{
 const ids=[];
 const times=[0,1,2,100];
 const r=await runWechatAgentLoop({
  messages:[{role:'user',content:'执行两个工具'}],tools:[],
  now:()=>times.shift()??100,
  limits:{rounds:2,tools:8,perRound:4,deadlineMs:50},
  complete:async()=>response(
   {id:'1',type:'function',function:{name:'list_growth',arguments:'{}'}},
   {id:'2',type:'function',function:{name:'delete_growth',arguments:'{}'}}),
  execute:async call=>{ids.push(call.function.name);return '已执行查询';}
 });
 assert.deepEqual(ids,['list_growth']);
 assert.match(r,/时间上限/);
});

test('zero and partial recent media updates are not full success',()=>{
 assert.equal(isCommittedMutationReply('update_recent_media','已更新最近 0/4 项照片或视频日期。'),false);
 assert.equal(isCommittedMutationReply('update_recent_media','已更新最近 2/4 项照片或视频日期。'),false);
 assert.equal(isCommittedMutationReply('update_recent_media','已更新最近 4/4 项照片或视频日期。'),true);
 assert.equal(isCommittedMutationReply('create_growth','已保存成长测量'),true);
});

function replayEnv(stepReplies,operations={}){
 let writes=0;
 const env={DB:{prepare(sql){
  let bound=[];
  return {
   bind(...args){bound=args;return this},
   async first(){
    if(sql.includes('FROM wechat_tool_steps'))return stepReplies[bound[0]]?{reply:stepReplies[bound[0]]}:null;
    throw Error('Unexpected first: '+sql);
   },
   async all(){
    if(sql.includes('FROM wechat_operation_log'))return {results:Object.entries(operations)
     .filter(([source])=>bound.includes(source)).map(([,id])=>({id}))};
    throw Error('Unexpected all: '+sql);
   },
   async run(){writes++;throw Error('Replayed step must never execute a new write');}
  };
 }}};
 return {env,get writes(){return writes}};
}

test('cached query replay restores server-owned result ID for later modification',async()=>{
 const db=replayEnv({'query:step:0':'测试宝宝的成长测量：\naaaaaaaa · 2026-10-01 · 体重 10kg'});
 const thread=getActiveThread(null,'bot','user',at);
 const reply=await runWechatPlan(db.env,baby,[call('list_growth',{day:'2026-10-01'})],
  {messageId:'query',text:'查询10月1日测量',at,thread});
 assert.match(reply,/aaaaaaaa/);
 assert.equal(thread.lastQuery.sourceMessageId,'query');
 assert.deepEqual(thread.lastQuery.ids,['aaaaaaaa']);
 assert.match(buildCommandContext('把第一条改为10.2kg',thread,at+1,baby.id).groundedText,/记录编号 aaaaaaaa/);
 assert.equal(db.writes,0);
});

test('cached successful mutation restores its undo operation without new writes',async()=>{
 const db=replayEnv({'edit:step:0':'已更新成长测量（编号 aaaaaaaa）。'},
  {'edit:step:0':'audit-existing-id'});
 const thread=getActiveThread(null,'bot','user',at);
 thread.pending={babyId:baby.id,expiresAt:at+30000,action:'update_growth'};
 const reply=await runWechatPlan(db.env,baby,[call('update_growth',{id:'aaaaaaaa',weight:10.2})],
  {messageId:'edit',text:'修改10月1日体重',at,thread});
 assert.match(reply,/已更新/);
 assert.equal(thread.lastOperation.opId,'audit-existing-id');
 assert.equal(thread.pending,null);
 assert.equal(db.writes,0);
});
