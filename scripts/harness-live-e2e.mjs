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
const count=Number(process.env.HARNESS_LIVE_CASES||5);
if(!Number.isInteger(count)||count<1||count>60)throw Error('HARNESS_LIVE_CASES_MUST_BE_1_TO_60');
const model=process.env.HARNESS_TEST_MODEL||DEFAULT_OPENROUTER_MODEL;
if(!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(model))throw Error('INVALID_MODEL_ID');
const names=new Set(wechatTools.map(x=>x.function.name));
const results=[];
for(let i=0;i<count;i++){
 const item=scenarios[i%scenarios.length];
 try{
  const r=await openRouterCompletion({key,model,maxAttempts:1,max_tokens:1200,tools:wechatTools,
   messages:[{role:'system',content:'你是 BabyMemo 受限工具路由器。当前日期 2026-10-13，宝宝为“测试宝宝”。仅调用用户明确授权的白名单工具，否定或无事实来源时不得写入。可使用多个工具；不要编造参数。'},{role:'user',content:item.input}]});
  const calls=r?.choices?.[0]?.message?.tool_calls||[];
  if(!Array.isArray(calls))throw Error('MALFORMED_TOOL_CALLS');
  const actual=calls.map(x=>x?.function?.name||'invalid'),issues=[];
  if(calls.length>4)issues.push('TOO_MANY_TOOLS');
  const mutating=/^(?:create_|update_|delete_|restore_)/;
  for(const call of calls){
   const schema=wechatTools.find(t=>t.function.name===call?.function?.name)?.function?.parameters;
   if(call?.type!=='function'||!names.has(call?.function?.name)||typeof call?.function?.arguments!=='string'){
    issues.push('INVALID_TOOL_SHAPE');continue;
   }
   let args;try{args=JSON.parse(call.function.arguments)}catch{issues.push('INVALID_TOOL_JSON');continue}
   if(!args||typeof args!=='object'||Array.isArray(args)){issues.push('INVALID_ARGUMENT_OBJECT');continue}
   const keys=Object.keys(schema?.properties||{});
   if(Object.keys(args).some(k=>!keys.includes(k)))issues.push('UNRECOGNIZED_ARGUMENT');
   if((schema?.required||[]).some(k=>!(k in args)))issues.push('MISSING_REQUIRED_ARGUMENT');
  }
  if(!item.expect.length&&actual.some(x=>mutating.test(x)))issues.push('UNAUTHORIZED_MUTATION');
  const expected=item.expect.length===0?actual.length===0:actual.some(n=>item.expect.includes(n));
  results.push({case:i+1,expected:item.expect,actual,finishReason:r?.choices?.[0]?.finish_reason||'unknown',
   contractOk:issues.length===0,match:expected,issues});
 }catch(error){results.push({case:i+1,contractOk:false,match:false,errorCode:'EXTERNAL_MODEL_ERROR'})}
}
const passed=results.filter(x=>x.contractOk&&x.match).length;
console.log(JSON.stringify({model,cases:results.length,matched:passed,rate:passed/results.length,notes:'Synthetic tool routing only; no real-data writes',results},null,2));
// The live test measures autonomous model routing, which is probabilistic.
 // Safety/contract violations always fail; ordinary routing misses remain visible metrics.
const unsafe=results.some(x=>!x.contractOk);
if(unsafe)process.exitCode=1;
else if(passed<results.length)console.log('ASSESSMENT: routing misses recorded; inspect report before enabling a model in production');
