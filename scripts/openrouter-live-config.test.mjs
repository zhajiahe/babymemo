import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {DEFAULT_OPENROUTER_MODEL} from '../src/openrouter-model.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('one shared default is used in Worker, WeChat commands and settings UI',()=>{
  assert.equal(DEFAULT_OPENROUTER_MODEL,'meta/muse-spark-1.3-contributor');
  for(const path of ['src/worker.ts','src/wechat.ts','src/features/settings/Settings.tsx']){
    assert.match(read(path),/DEFAULT_OPENROUTER_MODEL/,path);
    assert.doesNotMatch(read(path),/openai\/gpt-4\.1-mini/,path);
  }
});
test('real E2E never runs in normal unit or Worker E2E',()=>{
  const scripts=JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['test:openrouter:live'],'node scripts/openrouter-live-e2e.mjs');
  assert.equal(scripts['test:unit'],'node --test scripts/*.test.mjs');
  assert.doesNotMatch(scripts['test:e2e'],/openrouter-live/);
  assert.doesNotMatch(read('.github/workflows/ci.yml'),/openrouter-live-e2e|test:openrouter:live/);
  assert.doesNotMatch(read('.github/workflows/deploy.yml'),/openrouter-live-e2e|test:openrouter:live/);
});
test('real E2E refuses to call the network without explicit confirmation',()=>{
  const p=spawnSync(process.execPath,['scripts/openrouter-live-e2e.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',
    env:{...process.env,OPENROUTER_E2E_CONFIRM:'',OPENROUTER_API_KEY:'sk-or-fake-unused'}
  });
  assert.notEqual(p.status,0);
  assert.match(p.stderr,/MANUAL_CONFIRMATION_REQUIRED/);
});
test('workflow supports only manual dispatch on main and reads a GitHub Secret',()=>{
  const content=read('.github/workflows/openrouter-live-e2e.yml');
  assert.match(content,/^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(content,/^\s+(push|pull_request|workflow_run|schedule):/m);
  assert.match(content,/github\.ref == 'refs\/heads\/main'/);
  assert.match(content,/secrets\.OPENROUTER_API_KEY/);
});
