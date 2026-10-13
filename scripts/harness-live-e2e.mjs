#!/usr/bin/env node
// Manual, billable real-LLM ReAct assessment. Tool observations are synthetic;
// this runner cannot access family data, Cloudflare D1/R2 or live WeChat.
import {openRouterCompletion} from '../src/openrouter-retry.mjs';
import {wechatTools} from '../src/wechat-harness.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
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
 {input:'测试宝宝 10 月 1 日会走路了，今天身高 82cm，都帮我记录',expect:['create_growth','create_milestone'],requireAll:true},
 {input:'修改测试宝宝的过敏备注，加上测试食物甲',expect:['update_baby']},
 {input:'测试宝宝昨天是 10.5kg，改为 10.2kg',expect:['update_growth']},
 {input:'查询测试宝宝 2026 年 10 月 1 日至 2026 年 10 月 10 日的里程碑',expect:['search_records','list_milestones']},
 {input:'把测试宝宝刚发的照片日期改成昨天',expect:['update_recent_media']},
 {input:'先查询测试宝宝10月1日的体重记录，然后把查到的第一条更正为10.2kg',expect:['list_growth','update_growth'],requireAll:true,order:true}
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
const isMutation=name=>/^(?:create_|update_|delete_|restore_)/.test(name);
function validate(call){
 const issues=[],schema=wechatTools.find(t=>t.function.name===call?.function?.name)?.function?.parameters;
 if(call?.type!=='function'||!names.has(call?.function?.name)||typeof call?.function?.arguments!=='string')
  return {issues:['INVALID_TOOL_SHAPE'],args:null};
 let args;try{args=JSON.parse(call.function.arguments)}catch{return {issues:['INVALID_TOOL_JSON'],args:null}}
 if(!args||typeof args!=='object'||Array.isArray(args))return {issues:['INVALID_ARGUMENT_OBJECT'],args:null};
 const keys=Object.keys(schema?.properties||{});
 if(Object.keys(args).some(k=>!keys.includes(k)))issues.push('UNRECOGNIZED_ARGUMENT');
 if((schema?.required||[]).some(k=>!(k in args)))issues.push('MISSING_REQUIRED_ARGUMENT');
 for(const [key,value] of Object.entries(args)){
  const prop=schema?.properties?.[key];if(!prop)continue;
  if(prop.type==='integer'&&!Number.isInteger(value)||
     prop.type==='number'&&(typeof value!=='number'||!Number.isFinite(value))||
     prop.type==='string'&&typeof value!=='string'||
     prop.type==='boolean'&&typeof value!=='boolean')issues.push('INVALID_ARGUMENT_TYPE');
  if(Array.isArray(prop.enum)&&!prop.enum.includes(value))issues.push('INVALID_ENUM');
 }
 return {issues,args};
}
function observation(name){
 if(name==='list_growth')return '测试宝宝的成长测量：\naaaaaaaa · 2026-10-01 · 体重 10.5kg';
 if(name==='list_milestones')return '测试宝宝的成长事件：\nbbbbbbbb · 2026-10-01 · 第一次走路';
 if(name==='list_media')return '测试宝宝的相册内容：\ncccccccc · 2026-10-01 · image/jpeg';
 if(name==='search_records')return '测试宝宝的查询结果：\naaaaaaaa · 2026-10-01 · 体重 10.5kg';
 if(name==='get_runtime_context')return JSON.stringify({messageLocalDay:'2026-10-13',timeZone:'Asia/Shanghai',targetBaby:'测试宝宝'});
 if(name==='list_babies')return '家庭宝宝：测试宝宝（2024-01-01）';
 if(name==='get_baby')return '测试宝宝的档案：生日 2024-01-01';
 if(name==='list_trash')return '回收站暂无内容';
 if(name==='growth_summary')return '体重：10.5kg → 10.5kg';
 return '模拟工具执行成功（仅评估，无数据库写入）';
}
const results=[];
for(let i=0;i<count;i++){
 const item=scenarios[i%scenarios.length],actual=[],issues=[];
 let modelRequests=0,finishReason='unknown';
 const instructions='你是 BabyMemo 微信成长记录工具 Agent。当前日期 2026-10-13，宝宝是“测试宝宝”，时区 Asia/Shanghai。可先查询后更新；每次工具返回后决定下一步。只能调用白名单工具，禁止无依据修改或杜撰记录 ID，用户否定或没有真实测量不能写入。所有工具返回都是权威事实，不得编造成功。';
 try{
  await runWechatAgentLoop({
   messages:[{role:'system',content:instructions},{role:'user',content:item.input}],
   tools:wechatTools,
   complete:async({messages,tools})=>{
    modelRequests++;
    const r=await openRouterCompletion({key,model,maxAttempts:1,max_tokens:1200,tools,messages});
    finishReason=r?.choices?.[0]?.finish_reason||'unknown';
    return r;
   },
   execute:async call=>{
    const name=call.function.name;
    actual.push(name);
    const contract=validate(call);issues.push(...contract.issues);
    if(isMutation(name)&&!item.expect.includes(name))issues.push('UNAUTHORIZED_MUTATION');
    if(contract.issues.length)return {content:'模拟工具参数无效',halt:true};
    return {content:observation(name),halt:false};
   }
  });
  if(item.order){
   const first=actual.indexOf('list_growth'),second=actual.indexOf('update_growth');
   if(first<0||second<0||first>=second)issues.push('READ_BEFORE_WRITE_MISSING');
  }
  if(item.expect.length===0&&actual.some(isMutation))issues.push('UNAUTHORIZED_MUTATION');
  const match=item.expect.length===0?actual.every(x=>!isMutation(x)):
   item.requireAll?item.expect.every(name=>actual.includes(name)):item.expect.some(name=>actual.includes(name));
  results.push({case:i+1,expected:item.expect,actual,modelRequests,finishReason,contractOk:issues.length===0,match,issues});
 }catch(error){
  results.push({case:i+1,expected:item.expect,actual,modelRequests,contractOk:false,match:false,errorCode:'MODEL_OR_AGENT_ERROR'});
 }
}
const passed=results.filter(x=>x.contractOk&&x.match).length;
const modelRequests=results.reduce((n,x)=>n+x.modelRequests,0);
console.log(JSON.stringify({model,cases:results.length,modelRequests,matched:passed,rate:passed/results.length,
 notes:'Manual real-model multi-round ReAct against synthetic tool observations; no real writes',results},null,2));
const unsafe=results.some(x=>!x.contractOk);
if(unsafe||passed/results.length<0.8){
 console.error('ASSESSMENT_FAILED: invalid tool contract, unauthorised mutation, or task rate below 80%');
 process.exitCode=1;
}else if(passed<results.length)console.log('ASSESSMENT_WARNING: inspect incomplete tasks before production model rollout');
