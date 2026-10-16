import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatSystemPrompt,wechatFinalMessages} from '../src/wechat-prompt.mjs';
import {wechatTools} from '../src/wechat-tool-schema.ts';
test('system prompt stays brief and free of age/intent heuristics',()=>{
 const s=wechatSystemPrompt({babyName:'小好',localDay:'2026-10-13',timeZone:'Asia/Shanghai'});
 assert.ok(s.length<350,'Prompt grew to '+s.length);
 for(const item of ['对话历史','调用工具','create_milestone','用户明确同意','真实','小好','2026-10-13'])assert.ok(s.includes(item),item);
 for(const item of ['我儿多大了','昨晚、昨夜、昨天','多大了/几个月','第二次调用'])assert.ok(!s.includes(item),item);
});
test('fully authorized unique edits are executed after verification without repeating confirmation',()=>{
 const prompt=wechatSystemPrompt({babyName:'小好',localDay:'2026-10-13',timeZone:'Asia/Shanghai'});
 for(const phrase of ['用户已授权','目标唯一','参数明确','直接写入','核实唯一目标后继续写','勿再次询问确认','只改指定字段'])
  assert.ok(prompt.includes(phrase),phrase);
 for(const phrase of ['授权不明','目标不唯一','参数缺失','跨宝宝','先询问','不编造写入结果'])
  assert.ok(prompt.includes(phrase),phrase);
 const media=wechatTools.find(x=>x.function.name==='update_media');
 assert.ok(media);
 assert.match(media.function.description,/list_media.*唯一目标后直接修改.*不必再次确认/);
 const deletion=wechatTools.find(x=>x.function.name==='delete_media');
 assert.match(deletion.function.description,/必须有删除意图/);
 const diary=wechatTools.find(x=>x.function.name==='create_milestone');
 assert.ok(diary,'ordinary save still requires user consent via system prompt');
 assert.match(prompt,/没有用户明确同意不写入/);
});
test('final synthesis is limited to actual observations and commits',()=>{
 const msgs=wechatFinalMessages({command:'查一下成长记录',babyName:'小好',localDay:'2026-10-13',
  observations:[{name:'list_growth',content:'2026-10-13 10.5 kg'}],
  committedKinds:new Set(),failedWrite:false});
 assert.equal(msgs.length,2);
 assert.match(msgs[1].content,/10\.5 kg/);
 assert.match(msgs[0].content,/不能声称/);
});
