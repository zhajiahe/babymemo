import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script=fileURLToPath(new URL('./deploy-worker-with-retry.sh',import.meta.url));
const oldSha='a'.repeat(40),newSha='b'.repeat(40);
function scenario({messages=['success'],heads=[oldSha],event='workflow_run',withSecret=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'babymemo-retry-'));
 const make=(name,content)=>{
  const path=join(dir,name);writeFileSync(path,content);chmodSync(path,0o755);
 };
 make('npx',[
 '#!/usr/bin/env bash',
 'set -euo pipefail',
 '[[ "$*" == "wrangler deploy --keep-vars" || "$*" == "wrangler deploy --keep-vars --secrets-file $BABYMEMO_SECRETS_FILE" ]] || exit 91',
 'n=0',
 '[[ ! -f "$COUNT_FILE" ]] || n="$(cat "$COUNT_FILE")"',
 'n=$((n+1)); echo "$n" > "$COUNT_FILE"',
 'message="$(sed -n "$n"p "$MESSAGES_FILE")"',
 'if [[ "$message" == success ]]; then echo "Uploaded successfully"; exit 0; fi',
 'echo "$message"; exit 22',
 ''].join('\n'));
 make('git',[
 '#!/usr/bin/env bash',
 'set -euo pipefail',
 '[[ "$*" == "ls-remote origin refs/heads/main" ]] || exit 92',
 'n=0',
 '[[ ! -f "$HEAD_COUNT_FILE" ]] || n="$(cat "$HEAD_COUNT_FILE")"',
 'n=$((n+1)); echo "$n" > "$HEAD_COUNT_FILE"',
 'value="$(sed -n "$n"p "$HEADS_FILE")"',
 'printf "%s\\trefs/heads/main\\n" "$value"',
 ''].join('\n'));
 make('sleep',['#!/usr/bin/env bash','echo "$1" >> "$SLEEP_FILE"',''].join('\n'));
 writeFileSync(join(dir,'messages'),messages.join('\n')+'\n');
 writeFileSync(join(dir,'heads'),heads.join('\n')+'\n');
 const countPath=join(dir,'count'),headCount=join(dir,'head-count'),sleepPath=join(dir,'sleeps');
 const secretPath=join(dir,'openrouter.json');
 if(withSecret)writeFileSync(secretPath,JSON.stringify({OPENROUTER_API_KEY:'sk-or-test-only'}));
 try{
  const result=spawnSync('bash',[script],{
   env:{...process.env,PATH:dir+':'+process.env.PATH,
     GITHUB_EVENT_NAME:event,EXPECTED_SHA:oldSha,BABYMEMO_SECRETS_FILE:withSecret?secretPath:'',
     COUNT_FILE:countPath,MESSAGES_FILE:join(dir,'messages'),
     HEAD_COUNT_FILE:headCount,HEADS_FILE:join(dir,'heads'),SLEEP_FILE:sleepPath},
   encoding:'utf8',timeout:8000
  });
  if(result.error)throw result.error;
  const readNumber=(p)=>existsSync(p)?Number(readFileSync(p,'utf8').trim()):0;
  return {status:result.status,stdout:result.stdout+result.stderr,attempts:readNumber(countPath),
   checks:readNumber(headCount),delays:existsSync(sleepPath)?readFileSync(sleepPath,'utf8').trim().split('\n'):[]};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('transient Cloudflare 504 retries exactly once, preserves --keep-vars',()=>{
 const x=scenario({messages:['504 Gateway Timeout','success'],heads:[oldSha,oldSha]});
 assert.equal(x.status,0,x.stdout);
 assert.equal(x.attempts,2);
 assert.equal(x.checks,2);
 assert.deepEqual(x.delays,['15']);
});
test('repeated gateway errors stop after bounded three attempts',()=>{
 const x=scenario({messages:['503 Service Unavailable','502 Bad Gateway','504 Gateway Timeout'],heads:[oldSha,oldSha,oldSha]});
 assert.notEqual(x.status,0);
 assert.equal(x.attempts,3);
 assert.deepEqual(x.delays,['15','45']);
});
test('non-transient API permission failures do not retry',()=>{
 const x=scenario({messages:['403 Forbidden'],heads:[oldSha]});
 assert.notEqual(x.status,0);
 assert.equal(x.attempts,1);
 assert.deepEqual(x.delays,[]);
});
test('main changed during backoff prevents stale release',()=>{
 const x=scenario({messages:['504 Gateway Timeout','success'],heads:[oldSha,newSha]});
 assert.notEqual(x.status,0);
 assert.equal(x.attempts,1);
 assert.equal(x.checks,2);
 assert.match(x.stdout,/Refusing stale deployment/);
});
test('manual releases do not require current main SHA',()=>{
 const x=scenario({messages:['success'],heads:[],event:'workflow_dispatch'});
 assert.equal(x.status,0,x.stdout);
 assert.equal(x.attempts,1);
 assert.equal(x.checks,0);
});

test('optional deployment secret file is supplied to the same Worker publish',()=>{
 const x=scenario({withSecret:true});
 assert.equal(x.status,0,x.stdout);
 assert.equal(x.attempts,1);
});
