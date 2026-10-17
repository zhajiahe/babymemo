import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatSystemPrompt,wechatFinalMessages} from '../src/wechat-prompt.mjs';
import {wechatTools} from '../src/wechat-tool-schema.ts';
test('system prompt only contains stable intent, trust and outcome principles',()=>{
 const s=wechatSystemPrompt({babyName:'小好',localDay:'2026-10-13',timeZone:'Asia/Shanghai'});
 assert.ok(s.length<350,'Prompt grew to '+s.length);
 for(const item of ['对话历史','调用工具','用户已授权','目标唯一','参数明确','直接执行','查询结果本身不是写入授权','宝宝隔离','不能虚报','小好','2026-10-13'])assert.ok(s.includes(item),item);
 for(const item of ['processing','lastQuery','lastMedia','图片日期算法','上次查询第一条','第一次调用'])assert.ok(!s.includes(item),item);
});
test('write intent must be explicit, read capability is not authorization',()=>{
 const prompt=wechatSystemPrompt({babyName:'小好',localDay:'2026-10-13',timeZone:'Asia/Shanghai'});
 assert.match(prompt,/只能按当前用户指令行动/);
 assert.match(prompt,/只改指定字段/);
 assert.match(prompt,/先查询核实或询问/);
 const media=wechatTools.find(x=>x.function.name==='update_media');
 assert.match(media.function.description,/list_media.*唯一目标后直接修改.*不必再次确认/);
 const deletion=wechatTools.find(x=>x.function.name==='delete_media');
 assert.match(deletion.function.description,/必须有删除意图/);
});
test('final synthesis is limited to actual observations and commits',()=>{
 const msgs=wechatFinalMessages({command:'查一下成长记录',babyName:'小好',localDay:'2026-10-13',
  observations:[{name:'list_growth',content:'2026-10-13 10.5 kg'}],
  committedKinds:new Set(),failedWrite:false});
 assert.equal(msgs.length,2);
 assert.match(msgs[1].content,/10\.5 kg/);
 assert.match(msgs[0].content,/不能声称/);
});
