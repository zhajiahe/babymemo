import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('reachability audit is read-only and cautions against deleting dynamic entrypoints',()=>{const s=readFileSync(new URL('./dead-code-audit.mjs',import.meta.url),'utf8');assert.match(s,/unreferencedCandidates/);assert.match(s,/false positives/);assert.doesNotMatch(s,/unlinkSync|rmSync|execSync/);});
import {execFileSync} from 'node:child_process';
test('reachability audit prints candidates for review without deleting files',()=>{
 const output=execFileSync(process.execPath,[new URL('./dead-code-audit.mjs',import.meta.url).pathname],{encoding:'utf8'});
 const data=JSON.parse(output);
 assert.ok(Array.isArray(data.unreferencedCandidates));
 assert.ok(data.sourceFiles>0);
 console.log('Read-only import graph candidates:',data.unreferencedCandidates.join(', '));
});
