#!/usr/bin/env node
// Merge separately generated, synthetic-only reports; absent jobs are never scored 0%.
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {benchmarkMarkdownReport} from './model-benchmark-logging.mjs';

export function mergeBenchmarkReports(matrix,reports){
 const expected=matrix?.include;
 if(!Array.isArray(expected)||!expected.length)throw Error('INVALID_BENCHMARK_MATRIX');
 const seen=new Set(),models=[],missing=[];
 for(const job of expected){
  const item=reports[String(job.slot)];
  if(!item){missing.push(job);continue}
  if(seen.has(job.slot))throw Error('DUPLICATE_REPORT_SLOT');
  seen.add(job.slot);
  if(!Array.isArray(item.results)||item.results.length!==1||
     item.results[0].provider!==job.provider||
     job.provider==='openrouter'&&item.results[0].model!==job.model)
   throw Error('MISMATCHED_MODEL_REPORT_SLOT_'+job.slot);
  models.push(item.results[0]);
 }
 const first=Object.values(reports)[0];
 return {benchmark:'babymemo-model-parity-v2',timestamp:new Date().toISOString(),
  setup:{...(first?.setup||{}),modelCount:expected.length,comparisonIsolatedPerModel:true},
  results:models,missingModels:missing};
}

export async function writeMergedBenchmark({directory='bench-artifacts',matrix,output='model-benchmark-comparison.json',summaryFile=process.env.GITHUB_STEP_SUMMARY}){
 const files=await readdir(directory).catch(()=>[]);
 const reports={};
 for(const file of files.filter(x=>/^benchmark-\d+\.json$/.test(x))){
  const slot=file.match(/^benchmark-(\d+)\.json$/)[1];
  reports[slot]=JSON.parse(await readFile(directory+'/'+file,'utf8'));
 }
 const merged=mergeBenchmarkReports(matrix,reports);
 await writeFile(output,JSON.stringify(merged,null,2)+'\n');
 const markdown=benchmarkMarkdownReport(merged.results,{repetitions:merged.setup.repetitions||1,tasksPerModel:merged.setup.tasksPerModel||30})+
  (merged.missingModels.length?'\n**未获取到以下模型报告，不能视为答错：** '+
   merged.missingModels.map(x=>x.model).join(', ')+'\n':'');
 if(summaryFile)await writeFile(summaryFile,markdown,{flag:'a'});
 return merged;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const matrix=JSON.parse(process.env.MODEL_BENCH_MATRIX||'null');
 const result=await writeMergedBenchmark({matrix});
 console.log('Combined '+result.results.length+' model reports; missing '+result.missingModels.length);
 if(result.missingModels.length)process.exitCode=1;
}
