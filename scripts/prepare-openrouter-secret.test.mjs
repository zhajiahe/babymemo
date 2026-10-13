import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,rmSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareOpenRouterSecret,validateOpenRouterSecret} from './prepare-openrouter-secret.mjs';

test('missing deployment key never changes existing Worker secrets',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'babymemo-secret-'));
  try{
    assert.equal(prepareOpenRouterSecret({RUNNER_TEMP:tmp,GITHUB_ENV:join(tmp,'env')}),null);
    assert.equal(existsSync(join(tmp,'env')),false);
  }finally{rmSync(tmp,{recursive:true,force:true})}
});
test('optional OpenRouter key goes to private JSON file, never to CI environment outputs',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'babymemo-secret-'));
  const key='sk-or-v1-testing-only-private-token';
  try{
    const path=prepareOpenRouterSecret({RUNNER_TEMP:tmp,GITHUB_ENV:join(tmp,'env'),OPENROUTER_API_KEY:key});
    assert.equal(JSON.parse(readFileSync(path,'utf8')).OPENROUTER_API_KEY,key);
    assert.equal(statSync(path).mode&0o777,0o600);
    const envFile=readFileSync(join(tmp,'env'),'utf8');
    assert.ok(envFile.includes('BABYMEMO_SECRETS_FILE='));
    assert.equal(envFile.includes(key),false);
  }finally{rmSync(tmp,{recursive:true,force:true})}
});
test('refuses malformed, multiline or overlong keys',()=>{
  for(const key of ['abc','sk-or-hello\nnewline','sk-or-'+('x'.repeat(400)), 'sk-or-space name'])
    assert.throws(()=>validateOpenRouterSecret(key));
});
