import test from 'node:test';
import assert from 'node:assert/strict';
import {validDay,dayInZone,messageTime,guardAction,isCancel,isUndo} from '../src/wechat-policy.mjs';
const at=Date.parse('2026-10-13T18:50:00+08:00');
test('dates and trusted message timestamps are structurally validated',()=>{
 assert.equal(validDay('2026-10-10'),true);
 for(const s of ['2026-02-30','2026-2-3','2026-13-01','tomorrow',null])assert.equal(validDay(s),false);
 assert.equal(dayInZone(at,'Asia/Shanghai'),'2026-10-13');
 assert.equal(messageTime({create_time_ms:String(at)},at+1000),at);
 assert.equal(messageTime({create_time_ms:String(at+864000000)},at),at);
});
test('dates, measurements and record references are model responsibilities, not keyword authorization',()=>{
 const cases=[
  ['create_milestone',{day:'2026-10-10'},'可以可以。'],
  ['create_milestone',{day:'2026-10-10'},'把前面提到的那天记下来'],
  ['create_growth',{day:'2026-10-10',weight:12.3},'二十四点六斤，帮我记录'],
  ['update_growth',{id:'aaaaaaaa',weight:10.2},'刚才查到的第一条纠正一下'],
  ['update_milestone',{day:'2026-10-10',newDay:'2026-10-11'},'日期改成下周日'],
  ['delete_media',{id:'aaaaaaaa'},'把上一张照片丢到回收站'],
  ['restore_trash',{id:'aaaaaaaa',kind:'media'},'帮我找回来'],
  ['update_recent_media',{newDay:'2026-10-12'},'那批照片换成前天']
 ];
 for(const [action,args,text] of cases)assert.equal(guardAction(action,args,text),null,text);
});
test('unambiguous refusals remain hard-stopped',()=>{
 for(const [input,action] of [
  ['不要删除昨天的体重','delete_growth'],['先别修改宝宝资料','update_baby'],
  ['不要记录刚才的内容','create_milestone'],['不用保存这条记录','create_milestone'],
  ['禁止恢复记录','restore_trash']])
  assert.match(guardAction(action,{},input),/未修改/,input);
 assert.equal(guardAction('list_growth',{},'不要删除昨天的记录'),null);
});
test('cancel and undo remain exact commands',()=>{
 assert.equal(isCancel('取消'),true);
 assert.equal(isUndo('撤销'),true);
 assert.equal(isUndo('撤销最近一天的记录'),false);
});
