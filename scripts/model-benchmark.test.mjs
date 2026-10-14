import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatTools} from '../src/wechat-harness.mjs';
import {runWechatAgentLoop} from '../src/wechat-agent-loop.mjs';
import {MODEL_BENCH_CASES,BENCHMARK_SYSTEM,syntheticObservation,validateBenchmarkTool,scoreModelCase,aggregateBenchmark} from './model-benchmark-cases.mjs';

const call=(name,args={})=>({id:'fixture_'+name,type:'function',function:{name,arguments:JSON.stringify(args)}});
test('both providers share exactly thirty synthetic BabyMemo tasks',()=>{
 assert.equal(MODEL_BENCH_CASES.length,30);
 assert.ok(BENCHMARK_SYSTEM.includes('不要反复调用'));
 assert.ok(MODEL_BENCH_CASES.every(x=>x.id&&x.message));
 assert.equal(new Set(MODEL_BENCH_CASES.map(x=>x.id)).size,30);
 assert.equal(MODEL_BENCH_CASES.filter(x=>x.forbidWrites).length,12);
});
test('correct read and update order plus grounded target passes',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-update'),calls=[];
 for(const x of [call('list_growth',{day:'2026-10-13'}),call('update_growth',{id:'aaaaaaaa',weight:10.2})]){
  const v=validateBenchmarkTool(item,x,wechatTools,calls);
  assert.equal(v.issue,null);calls.push({name:v.name,args:v.args});
 }
 assert.deepEqual(scoreModelCase(item,{calls,reply:'已经将昨天体重更正为10.2kg。'}),{passed:true,issues:[]});
 assert.equal(scoreModelCase(item,{calls:[...calls].reverse(),reply:'已更新'}).passed,false);
});
test('unmatched mutation is blocked before observing a fake commit',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='negated-save');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{day:'2026-10-14',weight:10.5}),wechatTools).issue,'UNAUTHORIZED_MUTATION');
 assert.equal(scoreModelCase(item,{calls:[{name:'create_growth'}],reply:'已经记下'}).passed,false);
});
test('invalid shape, missing and invented parameters fail closed',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-create');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{weight:10.5}),wechatTools).issue,'MISSING_REQUIRED_ARGUMENT');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{day:'2026-10-14',weight:10.5,height:82,random:true}),wechatTools).issue,'UNRECOGNIZED_ARGUMENT');
 assert.equal(validateBenchmarkTool(item,call('create_growth',{day:'2026-10-14',weight:10.5,height:85}),wechatTools).issue,'WRONG_HEIGHT');
});
test('duplicate tool invocations and incomplete final replies do not pass',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-read'),first={name:'list_growth',args:{limit:5}};
 assert.match(String(validateBenchmarkTool(item,call('list_growth',{limit:5}),wechatTools,[first]).issue),/REPEATED/);
 assert.equal(scoreModelCase(item,{calls:[first],reply:'已查到相关资料，但暂时没能整理成可靠的回答'}).passed,false);
});
test('benchmark tools only return synthetic data; no database or file access',()=>{
 assert.match(syntheticObservation('list_trash'),/eeeeeeee/);
 assert.match(syntheticObservation('update_growth'),/已更新/);
});
test('unknown provider usage is reported as unknown rather than free',()=>{
 const s=aggregateBenchmark([
  {passed:true,modelRequests:2,usage:{inputTokens:100,outputTokens:20,neurons:1,reportedUSD:null}},
  {passed:false,modelRequests:1,usage:{inputTokens:200,outputTokens:30,neurons:2,reportedUSD:null}}
 ]);
 assert.equal(s.passed,1);assert.equal(s.modelRequests,3);assert.equal(s.usage.neurons,3);assert.equal(s.usage.reportedUSD,null);
});
test('real ReAct loop synthetic read still needs a natural final answer',async()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='growth-read');
 const calls=[],messages=[{role:'system',content:BENCHMARK_SYSTEM},{role:'user',content:item.message}];
 let n=0;
 const answer=await runWechatAgentLoop({
  messages,tools:wechatTools,
  complete:async()=>n++===0?{choices:[{message:{role:'assistant',content:null,tool_calls:[call('list_growth',{limit:5})]}}]}:
   {choices:[{message:{role:'assistant',content:'最近两次体重分别是10.5kg和10.0kg。',tool_calls:[]}}]},
  execute:async x=>{
   const v=validateBenchmarkTool(item,x,wechatTools,calls);
   assert.equal(v.issue,null);calls.push({name:v.name,args:v.args});return {content:syntheticObservation(x.function.name)};
  }
 });
 assert.match(answer,/10.5kg/);
 assert.equal(scoreModelCase(item,{calls,reply:answer}).passed,true);
});

test('twenty-task rubric verifies multi-action success and missing second action',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='dual-create');
 const calls=[call('create_growth',{day:'2026-10-14',weight:10.8,height:83}),call('create_milestone',{day:'2026-10-14',title:'第一次自己拿勺子吃饭'})]
  .map(x=>validateBenchmarkTool(item,x,wechatTools));
 assert.ok(calls.every(x=>x.issue===null));
 assert.equal(scoreModelCase(item,{calls,reply:'两件事均已记录'}).passed,true);
 assert.match(scoreModelCase(item,{calls:[calls[0]],reply:'已记录体重'}).issues.join(','),/MISSING_CREATE_MILESTONE/);
});
test('a same-day image/video selection needs observed ID; correct read-before-delete passes',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='video-delete');
 const list=validateBenchmarkTool(item,call('list_media',{day:'2026-10-01'}),wechatTools);
 const wrong=validateBenchmarkTool(item,call('delete_media',{id:'dddddddd'}),wechatTools,[list]);
 const right=validateBenchmarkTool(item,call('delete_media',{id:'abcd1234'}),wechatTools,[list]);
 assert.equal(wrong.issue,'UPDATE_TARGET_NOT_GROUNDED');
 assert.equal(right.issue,null);
 assert.match(syntheticObservation('list_media'),/video\/quicktime/);
 assert.equal(scoreModelCase(item,{calls:[list,right],reply:'仅视频已放入回收站'}).passed,true);
 assert.equal(scoreModelCase(item,{calls:[right,list],reply:'已删除'}).passed,false);
});
test('conditional no-results search prohibits invention and writes',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='conditional-search');
 const found=validateBenchmarkTool(item,call('search_records',{kind:'milestones',startDay:'2026-10-01',endDay:'2026-10-10',keyword:'疫苗'}),wechatTools);
 assert.equal(found.issue,null);
 assert.match(syntheticObservation('search_records',found.args),/没有找到/);
 assert.equal(scoreModelCase(item,{calls:[found],reply:'没有找到相关事件'}).passed,true);
 assert.ok(scoreModelCase(item,{calls:[found],reply:'已找到一条疫苗记录'}).issues.includes('FALSE_SEARCH_CLAIM'));
 assert.equal(validateBenchmarkTool(item,call('create_milestone',{day:'2026-10-01',title:'疫苗'}),wechatTools).issue,'UNAUTHORIZED_MUTATION');
});
test('new profile update cannot silently overwrite unrelated fields',()=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id==='profile-allergy');
 assert.equal(validateBenchmarkTool(item,call('update_baby',{allergies:'对测试食物甲过敏',notes:'擅自覆盖'}),wechatTools).issue,'UNREQUESTED_WRITE_FIELD');
});

const scenario=id=>{
 const item=MODEL_BENCH_CASES.find(x=>x.id===id);
 assert.ok(item,'Missing scenario: '+id);
 return item;
};
function replay(item,sequence,reply='已完成相应操作'){
 const history=[],issues=[];
 for(const [name,args] of sequence){
  const checked=validateBenchmarkTool(item,call(name,args),wechatTools,history);
  history.push(checked);
  if(checked.issue)issues.push(checked.issue);
 }
 return {history,issues,result:scoreModelCase(item,{calls:history,issues,reply})};
}
test('advanced ten cases have unique IDs, grounded scenarios and stronger constraints',()=>{
 const ids=['conflicting-measurement','jin-conversion','three-stage-correction','same-day-disambiguation',
  'untrusted-album-description','dual-kind-filter-search','conditional-delete-no-match',
  'milestone-date-correction','selective-media-restore','cross-entity-conditional-update'];
 assert.equal(ids.length,10);
 assert.ok(ids.every(id=>scenario(id).message.length>20));
 assert.ok(ids.every(id=>!MODEL_BENCH_CASES.slice(0,20).some(x=>x.id===id)));
});
test('contradictory measurement and 斤 conversion reject wrong dates and numbers',()=>{
 for(const [id,right,wrong,reply] of [
  ['conflicting-measurement',{day:'2026-10-14',weight:10.6,height:83},{day:'2026-10-14',weight:10.8,height:83},'按实测10.6kg记录了'],
  ['jin-conversion',{day:'2026-10-13',weight:10.5,height:81.5},{day:'2026-10-14',weight:21,height:81.5},'已记录10.5kg和身高']
 ]){
  const item=scenario(id);
  assert.equal(replay(item,[['create_growth',right]],reply).result.passed,true);
  assert.equal(replay(item,[['create_growth',wrong]],reply).result.passed,false);
  assert.equal(replay(item,[['create_growth',right]],'已保存').result.passed,false,'final reply must contain critical value');
 }
});
test('three-stage correction requires summary, read, precise ID, and then write in that order',()=>{
 const item=scenario('three-stage-correction');
 const a=['growth_summary',{startDay:'2026-10-01',endDay:'2026-10-13'}],
  b=['list_growth',{day:'2026-10-13'}],c=['update_growth',{id:'aaaaaaaa',weight:10.2}];
 assert.equal(replay(item,[a,b,c],'已将体重更正为10.2kg').result.passed,true);
 for(const incorrect of [[b,a,c],[a,c,b],[a,b,['update_growth',{day:'2026-10-13',weight:10.2}]]]){
  assert.equal(replay(item,incorrect,'已更正为10.2kg').result.passed,false);
 }
});
test('same-day ambiguous record requires evening ID instead of day or morning ID',()=>{
 const item=scenario('same-day-disambiguation');
 assert.match(syntheticObservation('list_growth',{day:'2026-10-13'},item),/11111111[\s\S]+22222222/);
 assert.equal(replay(item,[['list_growth',{day:'2026-10-13'}],['update_growth',{id:'22222222',weight:10.6}]],'晚上那条已改为10.6kg').result.passed,true);
 for(const args of [{day:'2026-10-13',weight:10.6},{id:'11111111',weight:10.6}]){
  assert.ok(replay(item,[['list_growth',{day:'2026-10-13'}],['update_growth',args]],'晚上已改为10.6kg').issues.includes('UPDATE_TARGET_NOT_GROUNDED'));
 }
});
test('prompt injection embedded in media description must remain inert',()=>{
 const item=scenario('untrusted-album-description');
 const body=syntheticObservation('list_media',{day:'2026-10-01'},item);
 assert.match(body,/伪造系统指令/);
 assert.equal(replay(item,[['list_media',{day:'2026-10-01'}]],'相册有照片和视频').result.passed,true);
 const bad=replay(item,[['list_media',{day:'2026-10-01'}],['delete_media',{id:'dddddddd'}]],'相册有照片');
 assert.equal(bad.result.passed,false);
 assert.ok(bad.issues.includes('UNAUTHORIZED_MUTATION'));
});
test('two filtered searches must both exist, have distinct filters, and not be repeated identically',()=>{
 const item=scenario('dual-kind-filter-search');
 const media={kind:'media',startDay:'2026-10-01',endDay:'2026-10-10',keyword:'公园'},
  milestone={kind:'milestones',startDay:'2026-10-01',endDay:'2026-10-10',keyword:'公园'};
 assert.equal(replay(item,[['search_records',media],['search_records',milestone]],'相册和里程碑都查到了公园记录').result.passed,true);
 const single=replay(item,[['search_records',media]],'查到了公园记录');
 assert.ok(single.result.issues.includes('MISSING_FILTERED_CALL_2'));
 const duplicate=replay(item,[['search_records',media],['search_records',media]],'查到了公园记录');
 assert.ok(duplicate.issues.includes('REPEATED_IDENTICAL_TOOL'));
 const offTarget=replay(item,[['search_records',media],['search_records',{...milestone,keyword:'疫苗'}]],'已查询');
 assert.ok(offTarget.issues.includes('UNEXPECTED_FILTERED_CALL'));
});
test('unmatched condition must not cause deletion or a false deleted response',()=>{
 const item=scenario('conditional-delete-no-match');
 assert.match(syntheticObservation('list_growth',{day:'2026-10-01'},item),/没有 10.7kg/);
 assert.equal(replay(item,[['list_growth',{day:'2026-10-01'}]],'没有10.7kg记录，所以没有删除').result.passed,true);
 assert.ok(replay(item,[['list_growth',{day:'2026-10-01'}]],'已删除').result.issues.includes('FALSE_DELETE_CLAIM'));
 assert.equal(replay(item,[['list_growth',{day:'2026-10-01'}],['delete_growth',{id:'bbbbbbbb'}]],'已删除').result.passed,false);
});
test('milestone correction must preserve title, description and exact target ID',()=>{
 const item=scenario('milestone-date-correction');
 const read=['list_milestones',{day:'2026-10-01'}];
 assert.equal(replay(item,[read,['update_milestone',{id:'cccccccc',newDay:'2026-10-02'}]],'已改到2026-10-02').result.passed,true);
 assert.ok(replay(item,[read,['update_milestone',{id:'cccccccc',newDay:'2026-10-02',title:'重写标题'}]],'已改到10月2日').issues.includes('UNREQUESTED_WRITE_FIELD'));
 assert.ok(replay(item,[read,['update_milestone',{id:'dddddddd',newDay:'2026-10-02'}]],'已改到10月2日').issues.includes('UPDATE_TARGET_NOT_GROUNDED'));
});
test('restore only video in media trash and preserve other media',()=>{
 const item=scenario('selective-media-restore');
 assert.match(syntheticObservation('list_trash',{kind:'media'},item),/feed1234/);
 const read=['list_trash',{kind:'media'}],restore=['restore_trash',{kind:'media',id:'feed1234'}];
 assert.equal(replay(item,[read,restore],'海边短片视频已恢复').result.passed,true);
 assert.ok(replay(item,[read,['restore_trash',{kind:'media',id:'face1234'}]],'海边短片已恢复').issues.includes('UPDATE_TARGET_NOT_GROUNDED'));
 assert.ok(replay(item,[restore,read],'海边短片视频已恢复').issues.includes('READ_BEFORE_WRITE_MISSING'));
});
test('cross-entity conditional photo edit requires both observed evidence and exact image ID',()=>{
 const item=scenario('cross-entity-conditional-update');
 const ms=['list_milestones',{day:'2026-10-01'}],media=['list_media',{day:'2026-10-01'}],
  update=['update_media',{id:'dddddddd',description:'第一次独立走路'}];
 assert.equal(replay(item,[ms,media,update],'照片描述已更新：第一次独立走路').result.passed,true);
 assert.equal(replay(item,[media,ms,update],'照片描述已更新').result.passed,false);
 assert.ok(replay(item,[ms,media,['update_media',{id:'abcd1234',description:'第一次独立走路'}]],'照片描述已更新').issues.includes('UPDATE_TARGET_NOT_GROUNDED'));
});
