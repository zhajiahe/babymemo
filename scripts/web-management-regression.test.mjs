import test from 'node:test';
import assert from 'node:assert/strict';
import {guardAction} from '../src/wechat-policy.mjs';
import {quickCommand,runWechatPlan} from '../src/wechat-orchestrator.mjs';
import {runWechatTool} from '../src/wechat-harness.mjs';
import {purgeDeletedMedia} from '../src/media-retention.mjs';
const at=Date.parse('2026-10-13T04:00:00Z'),baby={id:'synthetic',name:'测试宝宝',time_zone:'Asia/Shanghai'};
test('explicit refusal blocks writes even when the model supplies a valid tool',async()=>{
 const env={DB:{prepare(){return {bind(){return this},async first(){return null},async run(){throw Error('Unexpected write')}}}}};
 const args={day:'2026-10-13',weight:10.5},text='不要保存今天体重10.5kg';
 assert.ok(guardAction('create_growth',args,text,baby,at));
 assert.match(await runWechatPlan(env,baby,[{type:'function',function:{name:'create_growth',arguments:JSON.stringify(args)}}],{messageId:'read-only',text,at}),/未修改/);
});
test('complete milestone text does not get the missing-weight shortcut',async()=>{
 assert.equal(await quickCommand({},baby,'记录成长瞬间：测试宝宝今天会走路了',{pending:null},at),null);
});
test('single and recent media edits validate real calendar dates before writing',async()=>{
 const record={id:'12345678-abcd-4000-8000-000000000000',baby_id:baby.id,day:'2026-10-01'};
 const updates=[];
 const env={DB:{prepare(sql){let values;return{bind(...v){values=v;return this},async all(){return{results:[record]}},async run(){updates.push({sql,values});return{meta:{changes:1}}}}}}};
 assert.match(await runWechatTool(env,baby,'update_media',{day:'2026-10-01',newDay:'2026-10-02'},'edit','把10.1号照片改到10月2日',{at}),/已更新/);
 assert.equal(updates[0].values[0],'2026-10-02');
 assert.match(await runWechatTool(env,baby,'update_media',{day:'2026-10-01',newDay:'2026-02-30'},'invalid','改成二月底',{at}),/新日期不正确/);
 assert.match(await runWechatTool(env,baby,'update_recent_media',{newDay:'2026-02-30'},'recent-invalid','那批日期换一下',{at,thread:{lastMedia:{babyId:baby.id,ids:[record.id],expiresAt:at+60000}}}),/有效的新日期/);
 assert.equal(updates.length,1,'invalid dates must not issue any update');
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
