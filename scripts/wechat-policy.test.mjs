import test from 'node:test';
import assert from 'node:assert/strict';
import {validDay,explicitDay,dayInZone,relativeDay,guardAction,isNegativeOrConditional,
 measurementGrounded,messageTime,isCancel,isUndo} from '../src/wechat-policy.mjs';
const baby={id:'synthetic-a',time_zone:'Asia/Shanghai'};
const at=Date.parse('2026-10-13T00:10:00+08:00');
test('message date is stable across midnight and timezone',()=>{
 assert.equal(dayInZone(at,'Asia/Shanghai'),'2026-10-13');
 assert.equal(relativeDay(-1,at,'Asia/Shanghai'),'2026-10-12');
 assert.equal(explicitDay('小朋友昨天称了体重',at,'Asia/Shanghai'),'2026-10-12');
 assert.equal(explicitDay('10月1日测量',at,'Asia/Shanghai'),'2026-10-01');
 assert.equal(validDay('2026-02-30'),false);
 assert.equal(messageTime({create_time_ms:String(at)},at+120000),at);
 assert.equal(messageTime({create_time_ms:String(at+864000000)},at),at);
});
test('negative, hypothetical or conditional commands have zero mutation permission',()=>{
 for(const input of ['不要删除昨天的记录','先别删昨天记录','如果发现错了就删除昨天记录','取消删除昨天记录']){
  assert.equal(isNegativeOrConditional(input,'delete_growth'),true,input);
  assert.ok(guardAction('delete_growth',{day:'2026-10-12'},input,baby,at),input);
 }
 assert.equal(guardAction('delete_growth',{day:'2026-10-12'},'删除昨天的体重记录',baby,at),null);
});
test('colloquial dotted date is accepted without misreading a weight as a date',()=>{
 const at=Date.parse('2026-10-13T11:03:00+08:00'),tz='Asia/Shanghai';
 assert.equal(explicitDay('10.1号测试宝宝大概13.7kg',at,tz),'2026-10-01');
 assert.equal(explicitDay('10/1号测试宝宝约13.7kg',at,tz),'2026-10-01');
 assert.equal(explicitDay('测试宝宝大概13.7kg',at,tz),null);
 assert.equal(explicitDay('13.7kg',at,tz),null);
 assert.equal(explicitDay('2.30号称重',at,tz),null);
 assert.equal(guardAction('create_growth',{day:'2026-10-01',weight:13.7},'10.1号测试宝宝大概13.7kg',{time_zone:tz},at),null);
 assert.ok(guardAction('create_growth',{day:'2026-10-02',weight:13.7},'10.1号测试宝宝大概13.7kg',{time_zone:tz},at));
});
test('model cannot invent a numeric value, unit, record ID or date',()=>{
 assert.equal(measurementGrounded({weight:10.5},'今天体重 10.5kg'),true);
 assert.equal(measurementGrounded({weight:10},'今天体重 20斤'),true);
 assert.equal(measurementGrounded({weight:20},'今天体重 20斤'),false);
 assert.ok(guardAction('create_growth',{weight:10.5,day:'2026-10-13'},'今天没有称体重',baby,at));
 assert.ok(guardAction('update_growth',{id:'aaaaaaaa',weight:10.5},'把昨天的体重改成10.5kg',baby,at));
 assert.ok(guardAction('delete_media',{day:'2026-10-12'},'删除前天的照片',baby,at));
});
test('old/new date roles remain distinct',()=>{
 assert.equal(guardAction('update_milestone',{day:'2026-10-01',newDay:'2026-10-02'},'把10月1日改到10月2日',baby,at),null);
 assert.ok(guardAction('update_milestone',{day:'2026-10-02',newDay:'2026-10-01'},'把10月1日改到10月2日',baby,at));
});
test('cancel and undo are explicit, not inferred from casual messages',()=>{
 assert.equal(isCancel('取消'),true);assert.equal(isUndo('撤销'),true);
 assert.equal(isUndo('撤销最近一天的记录'),false);
});
