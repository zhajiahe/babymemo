import assert from 'node:assert/strict';
import test from 'node:test';
import {runWechatPlan,quickCommand} from '../src/wechat-orchestrator.mjs';
import {getActiveThread} from '../src/wechat-memory.mjs';
const at=Date.parse('2026-10-13T09:00:00+08:00'),baby={id:'synthetic-a',name:'测试宝宝',time_zone:'Asia/Shanghai'};
const call=(name,args={})=>({type:'function',function:{name,arguments:JSON.stringify(args)}});
function fake(){
 const steps=new Map(),mutations=[];
 const DB={prepare(sql){
  let bound=[];
  return {bind(...xs){bound=xs;return this},
   async first(){if(sql.includes('FROM wechat_tool_steps'))return steps.get(bound[0])||null;return null},
   async all(){if(sql.includes('FROM babies'))return {results:[{name:'测试宝宝',birthday:'2025-01-01'}]};return {results:[]}},
   async run(){if(sql.includes('INSERT OR IGNORE INTO wechat_tool_steps')){
      if(!steps.has(bound[0]))steps.set(bound[0],{reply:bound[3]});
    }else mutations.push({sql,bound});
    return {meta:{changes:1}}}
  };
 }};
 return {DB,steps,mutations};
}
test('model selecting an unsafe deletion cannot execute any mutation',async()=>{
 const env=fake(),thread=getActiveThread(null,'bot','user',at);
 const r=await runWechatPlan(env,baby,[call('delete_growth',{day:'2026-10-12'})],{
  messageId:'m1',text:'不要删除昨天的体重',groundedText:'不要删除昨天的体重',at,thread});
 assert.match(r,/尚未修改|未修改/);
 assert.equal(env.mutations.length,0);assert.equal(env.steps.size,0);
});
test('multiple read-only tools are bounded, replayed from stored results and no writes',async()=>{
 const env=fake(),thread=getActiveThread(null,'bot','user',at);
 const options={messageId:'m2',text:'列出宝宝两次',at,thread};
 const result=await runWechatPlan(env,baby,[call('list_babies'),call('list_babies')],options);
 assert.match(result,/家庭宝宝/);assert.equal(env.steps.size,2);
 const retry=await runWechatPlan(env,baby,[call('list_babies'),call('list_babies')],options);
 assert.equal(retry,result);assert.equal(env.steps.size,2);
 assert.equal(env.mutations.length,0);
});
test('a pending measurement can be cancelled before any write',async()=>{
 const env=fake(),thread=getActiveThread(null,'bot','user',at);
 const p=await quickCommand(env,baby,'帮我记一下体重',thread,at);
 assert.match(p,/补充/);
 assert.equal(thread.pending.action,'create_growth');
 assert.match(await quickCommand(env,baby,'取消',thread,at),/已取消/);
 assert.equal(thread.pending,null);assert.equal(env.mutations.length,0);
});
test('unknown or fabricated tool returns no mutation',async()=>{
 const env=fake();
 const r=await runWechatPlan(env,baby,[call('execute_sql',{sql:'DROP TABLE media'})],{messageId:'x',text:'执行 SQL',at});
 assert.match(r,/不受支持/);assert.equal(env.mutations.length,0);
});
