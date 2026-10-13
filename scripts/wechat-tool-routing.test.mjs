import test from 'node:test';
import assert from 'node:assert/strict';
import {readOnlyFallbackTool} from '../src/wechat-tool-routing.mjs';
test('read only fallback classifies explicit queries without allowing writes',()=>{
 const samples=[['查询小好最近五次体重','list_growth'],['查询小好的成长记录','list_growth'],['查看宝宝相册照片','list_media'],['查一下里程碑','list_milestones'],['看看回收站','list_trash'],['查询宝宝档案','get_baby'],
 ['删除昨天的体重',null],['查询后删除昨天的体重',null],['不要删除昨天的照片',null],
 ['修改体重',null],['补充过敏信息',null],['小好今天体重10kg',null],['找一下今天的照片，然后删除',null],['随便聊天',null]];
 for(const [text,expected] of samples)assert.equal(readOnlyFallbackTool(text),expected,text);
});
