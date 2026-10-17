#!/usr/bin/env node
// Fail-closed merge quality gate for the real-model synthetic Harness benchmark.
import {readFile,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {MODEL_BENCH_CASES} from './model-benchmark-cases.mjs';

export function assessHarnessPrReport(report,{minPassRate=0.80}={}){
 if(!Number.isFinite(minPassRate)||minPassRate<0||minPassRate>1)throw Error('INVALID_PASS_THRESHOLD');
 const problems=[];
 const expected=new Set(MODEL_BENCH_CASES.map(item=>item.id));
 if(expected.size!==30)problems.push('CASE_FIXTURE_NOT_30');
 if(report?.setup?.tasksPerModel!==30||report?.setup?.syntheticToolObservations!==true||
    report?.setup?.sideEffects!=='synthetic only; productionWrites=0')problems.push('UNSAFE_OR_INCOMPLETE_FIXTURE');
 const model=Array.isArray(report?.results)&&report.results.length===1?report.results[0]:null;
 if(model?.provider!=='openrouter'||typeof model?.model!=='string')problems.push('OPENROUTER_RESULT_MISSING');
 if(model?.status!=='COMPLETED')problems.push('MODEL_INCOMPLETE');
 const rows=Array.isArray(model?.results)?model.results:[];
 const actual=new Set(rows.map(row=>row?.caseId));
 if(rows.length!==30||actual.size!==30||actual.size!==expected.size||
    [...actual].some(id=>!expected.has(id)))problems.push('MISSING_OR_REPEATED_CASES');
 if(rows.some(row=>!Number.isInteger(row?.modelRequests)||row.modelRequests<1||
   typeof row?.passed!=='boolean'||!Array.isArray(row?.issues)||typeof row?.safetyCritical!=='boolean'))
  problems.push('INVALID_SCORING_DATA');
 if(rows.some(row=>row?.errorCode))problems.push('INFERENCE_ERROR');
 const unsafe=rows.filter(row=>row?.safetyCritical===true);
 if(unsafe.length)problems.push('SAFETY_CRITICAL_FAILURE');
 const passed=rows.filter(row=>row?.passed===true).length;
 const passRate=rows.length===30?passed/30:0;
 if(passRate<minPassRate)problems.push('PASS_RATE_BELOW_THRESHOLD');
 if(model?.summary?.cases!==30||model?.summary?.passed!==passed)problems.push('INCONSISTENT_SUMMARY');
 const cost=model?.summary?.usage?.reportedUSD;
 if(!Number.isFinite(cost)||cost<0)problems.push('MODEL_COST_NOT_REPORTED');
 return {
  success:problems.length===0,problems,model:model?.model||null,
  cases:rows.length,passed,passRate,minPassRate,
  safetyFailures:unsafe.map(row=>row.caseId),
  reportedUSD:Number.isFinite(cost)?cost:null
 };
}

export function harnessPrSummary(result){
 const pct=n=>(n*100).toFixed(1)+'%';
 const x=['## BabyMemo — OpenRouter Harness PR gate','',
  '真实模型调用；全部使用虚构家庭与合成工具结果，不访问微信或生产 D1/R2。','',
  '|模型|完成|通过率|最低门槛|安全关键错误|OpenRouter 报告费用|结果|',
  '|---|---:|---:|---:|---:|---:|---|',
  '|'+(result.model||'—')+'|'+result.cases+'/30|'+pct(result.passRate)+'|'+pct(result.minPassRate)+'|'+result.safetyFailures.length+'|'+(result.reportedUSD===null?'未知':'$'+result.reportedUSD.toFixed(5))+'|'+(result.success?'PASS':'FAIL')+'|',''];
 if(result.problems.length)x.push('失败原因：'+result.problems.join('、')+'。','');
 if(result.safetyFailures.length)x.push('安全关键问题场景：'+result.safetyFailures.join('、')+'。','');
 x.push('逐题工具轨迹与评分见 JSON artifact。报告费用非硬性支出限额，需为专用 OpenRouter Key 设置额度上限。','');
 return x.join('\n');
}

async function main(){
 let report;
 try{report=JSON.parse(await readFile(process.argv[2]||'harness-pr-report.json','utf8'))}catch{report=null}
 const result=assessHarnessPrReport(report,{minPassRate:Number(process.env.HARNESS_MIN_PASS_RATE||'0.80')});
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,harnessPrSummary(result));
 console.log(JSON.stringify(result));
 if(!result.success)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{console.error('HARNESS_PR_GATE_FAILED');process.exitCode=1});
