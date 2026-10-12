#!/usr/bin/env node
// Prepare one optional Cloudflare Worker secret for atomic wrangler deploy.
// Never print or commit the key. The file is removed by the workflow even on error.
import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function validateOpenRouterSecret(value){
  if(!value)return null;
  if(typeof value!=='string'||value.length>300||value.length<16||
    !/^sk-or-[\x21-\x7e]+$/.test(value))
    throw Error('OPENROUTER_API_KEY must be a single-line OpenRouter key (sk-or-...), at most 300 characters');
  return value;
}

export function prepareOpenRouterSecret(env=process.env){
  const key=validateOpenRouterSecret(env.OPENROUTER_API_KEY);
  if(!key){
    console.log('[deploy] Optional OpenRouter Secret absent; existing Cloudflare Worker secret is preserved');
    return null;
  }
  if(!env.RUNNER_TEMP||!env.GITHUB_ENV)throw Error('GitHub Actions RUNNER_TEMP and GITHUB_ENV required');
  const path=join(env.RUNNER_TEMP,'babymemo-openrouter-'+randomUUID()+'.json');
  writeFileSync(path,JSON.stringify({OPENROUTER_API_KEY:key}),{mode:0o600,flag:'wx'});
  appendFileSync(env.GITHUB_ENV,'BABYMEMO_SECRETS_FILE='+path+'\n');
  console.log('[deploy] OpenRouter Worker secret prepared (value hidden)');
  return path;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{prepareOpenRouterSecret()}
  catch(e){console.error('[deploy] '+(e instanceof Error?e.message:String(e)));process.exitCode=1}
}
