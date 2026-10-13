import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatSystemPrompt,wechatFinalMessages} from '../src/wechat-prompt.mjs';
test('system prompt stays brief and free of age/intent heuristics',()=>{
 const s=wechatSystemPrompt({babyName:'小好',localDay:'2026-10-13',timeZone:'Asia/Shanghai'});
 assert.ok(s.length<350,'Prompt grew to '+s.length);
 for(const item of ['先查工具','create_milestone','用户明确同意','真实','小好','2026-10-13'])assert.ok(s.includes(item),item);
 for(const item of ['我儿多大了','昨晚、昨夜、昨天','多大了/几个月','第二次调用'])assert.ok(!s.includes(item),item);
});
test('final synthesis is limited to actual observations and commits',()=>{
 const msgs=wechatFinalMessages({command:'查一下成长记录',babyName:'小好',localDay:'2026-10-13',
  observations:[{name:'list_growth',content:'2026-10-13 10.5 kg'}],
  committedKinds:new Set(),failedWrite:false});
 assert.equal(msgs.length,2);
 assert.match(msgs[1].content,/10\.5 kg/);
 assert.match(msgs[0].content,/不能声称/);
});
