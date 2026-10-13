#!/usr/bin/env node
// Explicit manual, potentially billable OpenRouter synthetic tool-contract evaluation.
// Does not connect to Cloudflare D1/R2 or live WeChat.
import {openRouterCompletion} from '../src/openrouter-retry.mjs';
import {wechatTools} from '../src/wechat-harness.mjs';
import {DEFAULT_OPENROUTER_MODEL} from '../src/openrouter-model.mjs';
const scenarios=[
 {input:'查询测试宝宝最近五条体重记录',expect:['list_growth']},
 {input:'测试宝宝今天体重 10.5kg',expect:['create_growth']},
 {input:'测试宝宝今天身高 82cm',expect:['create_growth']},
 {input:'查测试宝宝最近的成长瞬间',expect:['list_milestones']},
 {input:'测试宝宝今天第一次自己走路了，记一个里程碑',expect:['create_milestone']},
 {input:'查看测试宝宝的照片',expect:['list_media']},
 {input:'查询测试宝宝回收站',expect:['list_trash']},
 {input:'查询测试宝宝 2026 年 10 月 1 日到 10 月 10 日的体重变化',expect:['growth_summary','list_growth']},
 {input:'找测试宝宝今年九月记录的医院事件',expect:['search_records']},
 {input:'不要删除测试宝宝昨天的体重',expect:[]},
 {input:'测试宝宝今天好像 20 斤，但我还没有称重',expect:[]},
 {input:'测试宝宝 10 月 1 日会走路了，今天身高 82cm，都帮我记录',expect:['create_growth','create_milestone']},
 {input:'修改测试宝宝的过敏备注，加上测试食物甲',expect:['update_baby']},
 {input:'测试宝宝昨天是 10.5kg，改为 10.2kg',expect:['update_growth']},
 {input:'查询测试宝宝 2026 年 10 月 1 日至 2026 年 10 月 10 日的里程碑',expect:['search_records','list_milestones']},
 {input:'把测试宝宝刚发的照片日期改成昨天',expect:['update_recent_media']}
];
if(process.env.OPENROUTER_E2E_CONFIRM!=='YES'||process.env.HARNESS_LIVE_CONFIRM!=='YES')
 throw Error('MANUAL_CONFIRMATION_REQUIRED');
const key=process.env.OPENROUTER_API_KEY;
if(!key||!key.startsWith('sk-or-'))throw Error('OPENROUTER_API_KEY_MISSING');
const count=Math.min(60,Math.max(1,Number(process.env.HARNESS_LIVE_CASES||16)));
const model=process.env.HARNESS_TEST_MODEL||DEFAULT_OPENROUTER_MODEL;
const names=new Set(wechatTools.map(x=>x.function.name));
const results=[];
for(let i=0;i<count;i++){
 const item=scenarios[i%scenarios.length];
 try{
  const r=await openRouterCompletion({key,model,maxAttempts:1,max_tokens:850,tools:wechatTools,
   messages:[{role:'system',content:'你是 BabyMemo 受限工具路由器。当前日期 2026-10-13，宝宝为“测试宝宝”。仅调用用户明确授权的白名单工具，否定或无事实来源时不得写入。可使用多个工具；不要编造参数。'},{role:'user',content:item.input}]});
  const calls=r?.choices?.[0]?.message?.tool_calls||[],actual=calls.map(x=>x.function?.name);
  const valid=actual.every(n=>names.has(n)),expected=item.expect.length===0?actual.length===0:actual.some(n=>item.expect.includes(n));
  results.push({case:i+1,expected:item.expect,actual,contractOk:valid,match:expected});
 }catch(error){results.push({case:i+1,contractOk:false,match:false,errorCode:'EXTERNAL_MODEL_ERROR'})}
}
const passed=results.filter(x=>x.contractOk&&x.match).length;
console.log(JSON.stringify({model,cases:results.length,matched:passed,rate:passed/results.length,notes:'Synthetic tool routing only; no real-data writes',results},null,2));
if(passed<results.length)process.exitCode=1;
