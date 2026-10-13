import test from 'node:test';
import assert from 'node:assert/strict';
import {guardAction} from '../src/wechat-policy.mjs';
import {quickCommand,runWechatPlan} from '../src/wechat-orchestrator.mjs';
import {runWechatTool} from '../src/wechat-harness.mjs';
import {purgeDeletedMedia} from '../src/media-retention.mjs';
const at=Date.parse('2026-10-13T04:00:00Z'),baby={id:'synthetic',name:'测试宝宝',time_zone:'Asia/Shanghai'};
test('queries repeating values or dates cannot authorise any mutating tool',async()=>{
 const env={DB:{prepare(){return {bind(){return this},async first(){return null},async run(){throw Error('Unexpected write')},async all(){throw Error('Unexpected tool query')}}}}};
 for(const text of ['查询测试宝宝今天体重10.5kg有没有记录','看看今天10.5kg有没有记录','今天有没有记录第一次走路','怎么记录今天10.5kg','今天10.5kg？','今天记录10.5kg是否保存了？','今天修改后的体重10.5kg是多少？']){
  const args={day:'2026-10-13',weight:10.5};
  assert.ok(guardAction('create_growth',args,text,baby,at));
  assert.match(await runWechatPlan(env,baby,[{type:'function',function:{name:'create_growth',arguments:JSON.stringify(args)}}],{messageId:'read-only',text,at}),/未授权/);
 }
 assert.equal(guardAction('create_growth',{day:'2026-10-13',weight:10.5},'查询昨天的记录，并记录今天体重10.5kg',baby,at),null);
 assert.equal(guardAction('create_growth',{day:'2026-10-13',weight:10.5},'昨天身高80cm，今天体重10.5kg',baby,at),null);
 assert.ok(guardAction('create_growth',{day:'2026-10-12',weight:10.5},'昨天身高80cm，今天体重10.5kg',baby,at));
});
test('complete milestone text does not get the missing-weight shortcut',async()=>{
 assert.equal(await quickCommand({},baby,'记录成长瞬间：测试宝宝今天会走路了',{pending:null},at),null);
});
test('single and recent media edits accept grounded dates and reject invented dates',async()=>{
 const record={id:'12345678-abcd-4000-8000-000000000000',baby_id:baby.id,day:'2026-10-01'};
 const updates=[];
 const env={DB:{prepare(sql){let values;return{bind(...v){values=v;return this},async all(){return{results:[record]}},async run(){updates.push({sql,values});return{meta:{changes:1}}}}}}};
 assert.match(await runWechatTool(env,baby,'update_media',{day:'2026-10-01',newDay:'2026-10-02'},'edit','把10.1号照片改到10月2日',{at}),/已更新/);
 assert.equal(updates[0].values[0],'2026-10-02');
 assert.ok(guardAction('update_milestone',{day:'2026-10-01',newDay:'2026-10-09'},'把10月1日成长瞬间改成10月2日',baby,at));
 assert.equal(guardAction('update_recent_media',{newDay:'2026-10-12'},'把刚才的照片日期改成昨天',baby,at),null);
});
test('a restore winning before the purge claim preserves both objects',async()=>{
 const deleted=[];
 await purgeDeletedMedia({DB:{prepare(sql){return{bind(){return this},async all(){return{results:[{id:'media'}]}},async first(){return null},async run(){throw Error('Unexpected removal')}}}},MEDIA:{async delete(keys){deleted.push(keys)}}},at);
 assert.deepEqual(deleted,[]);
});
test('R2 failure leaves a persistent claim and retry removes only the claimed row',async()=>{
 let claim=null,removed=false,fail=true;
 const env={DB:{prepare(sql){let args;return{bind(...xs){args=xs;return this},async all(){return{results:removed?[]:[{id:'media'}]}},async first(){claim??={id:'media',object_key:'private/test/media',purge_token:args[0]};return claim},async run(){assert.equal(args[1],claim.purge_token);removed=true;return{meta:{changes:1}}}}}},MEDIA:{async delete(){if(fail)throw Error('R2 temporary failure')}}};
 await assert.rejects(purgeDeletedMedia(env,at));assert.ok(claim);assert.equal(removed,false);
 fail=false;await purgeDeletedMedia(env,at);assert.equal(removed,true);
});
