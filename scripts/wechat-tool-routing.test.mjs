import test from 'node:test';
import assert from 'node:assert/strict';
import {readOnlyFallbackTool,retryReadOnlyTool} from '../src/wechat-tool-routing.mjs';
test('read only fallback classifies explicit queries without allowing writes',()=>{
 const samples=[['查询小好最近五次体重','list_growth'],['查询小好的成长记录','list_growth'],['查看宝宝相册照片','list_media'],['查一下里程碑','list_milestones'],['看看回收站','list_trash'],['查询宝宝档案','get_baby'],
 ['删除昨天的体重',null],['查询后删除昨天的体重',null],['不要删除昨天的照片',null],
 ['修改体重',null],['补充过敏信息',null],['小好今天体重10kg',null],['找一下今天的照片，然后删除',null],['随便聊天',null]];
 for(const [text,expected] of samples)assert.equal(readOnlyFallbackTool(text),expected,text);
});

test('safe read-only re-ask uses AUTO, not forced named tool_choice',async()=>{
 const tool={type:'function',function:{name:'list_growth',parameters:{type:'object',properties:{limit:{type:'integer'}}}}};
 let seen=null,calls=0;
 const chosen=await retryReadOnlyTool({
  command:'查询测试宝宝最近五条体重',tools:[tool],messages:[{role:'user',content:'测试'}],
  complete:async options=>{
   calls++;seen=options;
   return {choices:[{message:{tool_calls:[{type:'function',function:{name:'list_growth',arguments:'{"limit":5}'}}]}}]};
  }
 });
 assert.equal(calls,1);
 assert.equal(seen.tool_choice,'auto');
 assert.equal(seen.maxAttempts,1);
 assert.equal(seen.tools.length,1);
 assert.equal(chosen[0].function.name,'list_growth');
});
test('safe fallback never retries mutating requests, rejects unexpected calls and fails closed on provider 400',async()=>{
 const tools=['list_growth','delete_growth'].map(name=>({type:'function',function:{name,parameters:{type:'object'}}}));
 let executions=0;
 const never=async()=>{executions++;throw Error('should not be called')};
 assert.equal(await retryReadOnlyTool({command:'删除昨天的体重',tools,complete:never,messages:[]}),null);
 assert.equal(await retryReadOnlyTool({command:'查询后删除昨天体重',tools,complete:never,messages:[]}),null);
 assert.equal(executions,0);
 const cases=[
  async()=>{throw Error('OPENROUTER_HTTP_400')},
  async()=>({choices:[{message:{tool_calls:[{type:'function',function:{name:'delete_growth',arguments:'{}'}}]}}]}),
  async()=>({choices:[{message:{tool_calls:[{type:'function',function:{name:'list_growth',arguments:'{bad json'}}]}}]}),
  async()=>({choices:[{message:{tool_calls:[]}}]})
 ];
 for(const complete of cases)
  assert.equal(await retryReadOnlyTool({command:'查询昨天的体重',tools,complete,messages:[]}),null);
});
