import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const deploy=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
test('Auto deploy is gated by full successful same-repo main push CI',()=>{
 assert.match(deploy,/workflow_run:[\s\S]*workflows: \["Check BabyMemo"\]/);
 assert.match(deploy,/types: \[completed\]/);
 for(const rule of ["conclusion == 'success'","event == 'push'","head_branch == 'main'","head_repository.full_name == github.repository"])assert.ok(deploy.includes(rule),rule);
 assert.match(ci,/push:[\s\S]*branches: \[main\]/);
 assert.match(ci,/name: Local Worker E2E/);
 assert.match(ci,/name: Browser E2E \(Chromium\)/);
});
test('Auto path deploys tested commit, ignores stale successes, never auto-provisions',()=>{
 assert.match(deploy,/ref: \$\{\{ needs.gate.outputs.revision \}\}/);
 assert.match(deploy,/revision=\$TESTED_SHA/);
 assert.equal(deploy.split('git ls-remote origin refs/heads/main').length-1,2);
 assert.match(deploy,/safe_to_publish=true/);
 assert.match(deploy,/proceed=false/);
 assert.match(deploy,/provision=false/);
 assert.match(deploy,/npm run provision:remote -- --check/);
 assert.match(deploy,/cancel-in-progress: false/);
 assert.match(deploy,/wrangler d1 migrations apply DB --remote/);
 assert.match(deploy,/wrangler deploy --keep-vars/);
});
test('Manual dry runs retained; auto never rotates secrets',()=>{
 assert.match(deploy,/workflow_dispatch:/);
 assert.match(deploy,/MANUAL_DRY_RUN:/);
 assert.match(deploy,/MANUAL_PROVISION:/);
 assert.match(deploy,/Sync configured Worker secrets \(manual release only\)/);
 assert.match(deploy,/github.event_name == 'workflow_dispatch' && needs.gate.outputs.dry_run == 'false'/);
 assert.match(deploy,/wrangler secret put/);
 assert.doesNotMatch(deploy,/wrangler secret delete|wrangler d1 delete|wrangler r2 bucket delete/);
 assert.match(deploy,/npm run smoke:check/);
});
