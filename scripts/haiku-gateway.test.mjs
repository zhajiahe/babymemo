import assert from 'node:assert/strict';
import test from 'node:test';
import {haikuGatewayCompletion,toHaikuRequest,fromHaikuResponse,haiku55Cost,DEFAULT_HAIKU_MODEL} from '../src/haiku-gateway.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
import {wechatTools} from '../src/wechat-harness.mjs';

// 10 SYNTHETIC domestic WeChat conversations. Responses below are FIXTURES,
// not actual Anthropic inference. Zero Cloudflare requests, tokens or spend.
const tool=(name,input={})=>({id:'toolu_mock_'+name,type:'tool_use',name,input});
const toolResponse=(name,input)=>({content:[tool(name,input)],stop_reason:'tool_use'});
const final=text=>({content:[{type:'text',text}],stop_reason:'end_turn'});
const scenarios=[
 {name:'查询最近体重',input:'查测试宝宝最近5条体重记录',responses:[toolResponse('list_growth',{limit:5}),final('最近一条体重是10.5kg。')],expected:['list_growth']},
 {name:'新增体重',input:'测试宝宝今天体重10.5kg，记一下',responses:[toolResponse('create_growth',{day:'2026-10-14',weight:10.5}),final('已经记下今天10.5kg的体重啦。')],expected:['create_growth']},
 {name:'新增里程碑',input:'测试宝宝今天独立走了五步，记成里程碑',responses:[toolResponse('create_milestone',{day:'2026-10-14',title:'独立走了五步'}),final('这个成长瞬间已经记在里程碑里啦。')],expected:['create_milestone']},
 {name:'先查后改',input:'把昨天的体重从10.5kg更正为10.2kg，先查一下',responses:[toolResponse('list_growth',{day:'2026-10-13'}),toolResponse('update_growth',{id:'aaaaaaaa',weight:10.2}),final('昨天的体重已更正为10.2kg。')],expected:['list_growth','update_growth']},
 {name:'删除指定记录',input:'把测试宝宝2026年10月1日的体重移到回收站',responses:[toolResponse('delete_growth',{day:'2026-10-01'}),final('已将这条体重记录移到回收站。')],expected:['delete_growth']},
 {name:'禁止错误写入',input:'不要记录，刚才说的10.5kg是随口说的',responses:[final('明白，不会新增或修改体重记录。')],expected:[]},
 {name:'未经测量不得写入',input:'测试宝宝今天应该有20斤吧，但没有称重',responses:[final('这是估计值，暂不作为实测体重保存。')],expected:[]},
 {name:'浏览相册',input:'看看测试宝宝10月1日的照片',responses:[toolResponse('list_media',{day:'2026-10-01'}),final('那天有一张照片，想看哪一张？')],expected:['list_media']},
 {name:'最近相片日期更正',input:'把刚才发的照片日期改成昨天',responses:[toolResponse('update_recent_media',{newDay:'2026-10-13'}),final('已把刚才照片的拍摄日期改为昨天。')],expected:['update_recent_media']},
 {name:'查询后恢复',input:'从测试宝宝回收站里把10月1日的体重恢复',responses:[toolResponse('list_trash',{kind:'growth'}),toolResponse('restore_trash',{kind:'growth',id:'aaaaaaaa'}),final('对应体重记录已恢复。')],expected:['list_trash','restore_trash']}
];
function observation(name){
 if(name==='list_growth')return '测试宝宝的成长测量：\naaaaaaaa · 2026-10-13 · 体重 10.5kg';
 if(name==='list_trash')return '回收站：aaaaaaaa · 2026-10-01 · 体重 10.5kg';
 if(name==='list_media')return '测试宝宝相册：bbbbbbbb · 2026-10-01 · image/jpeg';
 if(name.startsWith('create_'))return '已保存成长记录（编号 aaaaaaaa）。';
 if(name.startsWith('update_'))return '已更新成长记录（编号 aaaaaaaa）。';
 if(name.startsWith('delete_'))return '已将记录移到回收站。';
 if(name.startsWith('restore_'))return '已恢复记录（编号 aaaaaaaa）。';
 return '查询成功';
}
for(const scenario of scenarios){
 test('Haiku 5.5 MOCK scenario: '+scenario.name,async()=>{
  let responses=[...scenario.responses],calls=0,seen=[];
  const answer=await runWechatAgentLoop({
   messages:[{role:'system',content:'你是虚构家庭“测试宝宝”的微信助手。日期2026-10-14。只用已授权的工具操作记录。'}, {role:'user',content:scenario.input}],
   tools:wechatTools,
   complete:async({messages,tools})=>{
    calls++;
    const expected=responses.shift();
    assert.ok(expected,'mock requires no more than planned rounds');
    return haikuGatewayCompletion({messages,tools,run:async(model,payload)=>{
     assert.equal(model,DEFAULT_HAIKU_MODEL);
     assert.ok(Array.isArray(payload.messages));
     if(calls>1&&seen.length)assert.ok(payload.messages.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='tool_result')));
     return {...expected,usage:{input_tokens:0,output_tokens:0}};
    }});
   },
   execute:async call=>{
    const name=call.function.name;
    seen.push(name);
    const authorized=scenario.expected.includes(name);
    assert.ok(authorized,'unexpected synthetic tool: '+name);
    return {content:observation(name),committed:/^(create_|update_|delete_|restore_)/.test(name),halt:false};
   }
  });
  assert.deepEqual(seen,scenario.expected);
  assert.ok(answer.length>0);
  assert.equal(responses.length,0);
 });
}
test('Anthropic assistant/tool blocks and tool result grouping normalize back to ReAct tool_calls',()=>{
 const p=toHaikuRequest({messages:[{role:'system',content:'a'},{role:'user',content:'find'},{role:'assistant',content:null,tool_calls:[{id:'toolu_1',type:'function',function:{name:'list_growth',arguments:'{"limit":5}'}}]},{role:'tool',tool_call_id:'toolu_1',content:'10.5kg'}],tools:[{type:'function',function:{name:'list_growth',parameters:{type:'object',properties:{limit:{type:'integer'}}}}}]});
 assert.equal(p.system,'a');assert.equal(p.messages[2].content[0].type,'tool_result');assert.equal(p.tools[0].input_schema.type,'object');
 const r=fromHaikuResponse({content:[{type:'tool_use',id:'toolu_2',name:'list_growth',input:{limit:5}}],stop_reason:'tool_use'});
 assert.equal(r.choices[0].message.tool_calls[0].function.arguments,'{"limit":5}');
});
test('third-party Gateway USD pricing is not free-neurons pricing',()=>{
 const c=haiku55Cost({input_tokens:10000,output_tokens:1000,cache_read_input_tokens:5000,cache_creation_input_tokens:0});
 assert.equal(c.inputTokens,10000);assert.equal(c.outputTokens,1000);
 assert.ok(Math.abs(c.estimatedUSD-0.00155)<1e-10);
});
