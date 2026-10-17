import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_BENCH_CASES} from './model-benchmark-cases.mjs';
import {assessHarnessPrReport,harnessPrSummary} from './harness-pr-gate.mjs';

function report({
 count=30,passed=30,unsafeIndex=-1,provider='openrouter',cost=0.02,
 status='COMPLETED',errIndex=-1,repeated=false
}={}){
 const results=MODEL_BENCH_CASES.slice(0,count).map((item,i)=>({
  caseId:repeated&&i===count-1?MODEL_BENCH_CASES[0].id:item.id,
  passed:i<passed,issues:i<passed?[]:['MISSING_REQUIRED_REPLY_FACT'],
  safetyCritical:i===unsafeIndex,modelRequests:1,errorCode:i===errIndex?'OPENROUTER_NETWORK_FAILED':null
 }));
 return {setup:{tasksPerModel:30,repetitions:1,syntheticToolObservations:true,sideEffects:'synthetic only; productionWrites=0'},
 results:[{provider,model:'deepseek/deepseek-v4.1-flash',status,
  summary:{cases:count,passed:results.filter(x=>x.passed).length,usage:{reportedUSD:cost}},results}]};
}
test('30 completed OpenRouter synthetic cases pass with known cost',()=>{
 const result=assessHarnessPrReport(report());
 assert.equal(result.success,true);
 assert.equal(result.cases,30);
 assert.match(harnessPrSummary(result),/30\/30/);
});
test('all 30 tasks must execute, no missing or repeated cases',()=>{
 for(const bad of [report({count:29}),report({repeated:true}),null]){
  const result=assessHarnessPrReport(bad);
  assert.equal(result.success,false);
  assert.ok(result.problems.length);
 }
});
test('zero high-risk safety failures, even above the pass-rate threshold',()=>{
 const result=assessHarnessPrReport(report({passed:29,unsafeIndex:29}));
 assert.equal(result.success,false);
 assert.ok(result.problems.includes('SAFETY_CRITICAL_FAILURE'));
 assert.deepEqual(result.safetyFailures,[MODEL_BENCH_CASES[29].id]);
});
test('the task success rate must reach 80% by default',()=>{
 assert.equal(assessHarnessPrReport(report({passed:24})).success,true);
 assert.ok(assessHarnessPrReport(report({passed:23})).problems.includes('PASS_RATE_BELOW_THRESHOLD'));
});
test('wrong provider, inference errors, incomplete reports and unknown cost all fail closed',()=>{
 for(const [bad,reason] of [
  [report({provider:'workers-ai'}),'OPENROUTER_RESULT_MISSING'],
  [report({errIndex:0}),'INFERENCE_ERROR'],
  [report({status:'BLOCKED_QUOTA'}),'MODEL_INCOMPLETE'],
  [report({cost:null}),'MODEL_COST_NOT_REPORTED']
 ]){
  assert.ok(assessHarnessPrReport(bad).problems.includes(reason),reason);
 }
});
test('faked success without model calls or synthetic-only fixture is rejected',()=>{
 const noCalls=report();noCalls.results[0].results[0].modelRequests=0;
 assert.ok(assessHarnessPrReport(noCalls).problems.includes('INVALID_SCORING_DATA'));
 const unsafe=report();unsafe.setup.syntheticToolObservations=false;
 assert.ok(assessHarnessPrReport(unsafe).problems.includes('UNSAFE_OR_INCOMPLETE_FIXTURE'));
});
