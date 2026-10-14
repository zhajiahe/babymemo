#!/usr/bin/env node
// One manual dispatch -> isolated parallel jobs, each using the same canonical cases.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const MODEL_RE=/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
export function buildBenchmarkMatrix({provider='both',modelPreset='deepseek/deepseek-v4.1-flash',modelIds=''}={}){
 if(!['both','workers-ai','openrouter'].includes(provider))throw Error('INVALID_PROVIDER');
 const include=[];
 if(provider!=='openrouter')include.push({provider:'workers-ai',model:'workers-ai'});
 if(provider!=='workers-ai'){
  if(typeof modelIds!=='string'||typeof modelPreset!=='string')throw Error('INVALID_MODEL_INPUT');
  const tokens=modelIds.trim()?modelIds.split(/[\s,;]+/).filter(Boolean):[modelPreset];
  const models=[...new Set(tokens)];
  if(models.length<1||models.length>6)throw Error('MODEL_COUNT_MUST_BE_1_TO_6');
  if(models.some(x=>!MODEL_RE.test(x)))throw Error('INVALID_OPENROUTER_MODEL');
  for(const model of models)include.push({provider:'openrouter',model});
 }
 return {include:include.map((x,slot)=>({...x,slot}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 console.log('matrix='+JSON.stringify(buildBenchmarkMatrix({
  provider:process.env.MODEL_BENCH_PROVIDER,
  modelPreset:process.env.MODEL_BENCH_PRESET,
  modelIds:process.env.MODEL_BENCH_MODEL_IDS
 })));
