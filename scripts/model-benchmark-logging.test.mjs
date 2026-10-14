import test from 'node:test';
import assert from 'node:assert/strict';
import {safeBenchPreview,benchmarkFailureKind,isFatalBenchmarkError,diagnosticEvent,benchmarkMarkdownReport} from './model-benchmark-logging.mjs';

test('benchmark logs never leak API tokens, bearer credentials or excessively long outputs',()=>{
 const p=safeBenchPreview('Bearer secretval sk-or-v1-private_EXAMPLE12345678901234567890 '+'a'.repeat(70),80);
 assert.doesNotMatch(p,/private_EXAMPLE|Bearer secretval|aaaaaa/);
 assert.match(p,/REDACTED/);
 assert.ok(p.length<=81);
});
test('Workers AI 10000 is an authentication block, not a zero-percent model score',()=>{
 assert.equal(benchmarkFailureKind('WORKERS_AI_HTTP_10000'),'AUTHENTICATION_OR_PERMISSION');
 assert.equal(isFatalBenchmarkError('WORKERS_AI_HTTP_10000'),true);
 assert.equal(isFatalBenchmarkError('OPENROUTER_HTTP_401'),true);
 assert.equal(isFatalBenchmarkError('OPENROUTER_HTTP_402'),true);
 assert.equal(isFatalBenchmarkError('WORKERS_AI_HTTP_429'),false);
});
test('rich diagnostic events include timing, token usage and tools without raw text or headers',()=>{
 const d=JSON.parse(diagnosticEvent('model_request_complete',{
   provider:'openrouter',model:'deepseek/deepseek-v4.1-flash',caseId:'growth-update',
   request:2,elapsedMs:2100,inputTokens:321,outputTokens:44,reasoningTokens:0,
   reasoningRequested:'off',toolNames:['list_growth'],assistant:'你好'
 }).replace('[model-benchmark] ',''));
 assert.equal(d.elapsedMs,2100);
 assert.equal(d.reasoningTokens,0);
 assert.deepEqual(d.toolNames,['list_growth']);
 assert.equal(d.reasoningRequested,'off');
});
test('Actions Markdown summary exposes per-case model, tools, tokens, results and errors',()=>{
 const models=[{model:'deepseek/deepseek-v4.1-flash',reasoningRequested:'off',status:'COMPLETED',
 summary:{passed:1,cases:1,modelRequests:2,usage:{inputTokens:100,outputTokens:20,neurons:null,reportedUSD:0.0001}},
 results:[{name:'先查再更正',passed:true,tools:['list_growth','update_growth'],modelRequests:2,latencyMs:3000,
  usage:{inputTokens:100,outputTokens:20,reasoningTokens:0,neurons:null,reportedUSD:0.0001},issues:[]}]
 }];
 const summary=benchmarkMarkdownReport(models,{repetitions:1});
 assert.match(summary,/DeepSeek|deepseek\/deepseek-v4.1-flash/i);
 assert.match(summary,/先查再更正/);
 assert.match(summary,/list_growth → update_growth/);
 assert.match(summary,/100\/20/);
 assert.match(summary,/每模型 20 题/);
});
