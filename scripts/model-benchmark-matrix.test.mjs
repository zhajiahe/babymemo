import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBenchmarkMatrix} from './model-benchmark-matrix.mjs';
import {mergeBenchmarkReports} from './model-benchmark-merge.mjs';

test('single manual dispatch creates parallel isolated jobs for workers and three OpenRouter models',()=>{
 const m=buildBenchmarkMatrix({provider:'both',modelPreset:'ignored/model',modelIds:'deepseek/deepseek-v4.1-flash, meta/muse-spark-1.3-contributor\nopenai/gpt-6-luna'});
 assert.equal(m.include.length,4);
 assert.deepEqual(m.include.map(x=>x.slot),[0,1,2,3]);
 assert.deepEqual(m.include.map(x=>x.provider),['workers-ai','openrouter','openrouter','openrouter']);
 assert.equal(m.include[2].model,'meta/muse-spark-1.3-contributor');
});
test('preset fallback, deduplication, and Workers-only mode',()=>{
 assert.equal(buildBenchmarkMatrix({provider:'openrouter',modelPreset:'meta/muse-spark-1.3-contributor'}).include[0].model,'meta/muse-spark-1.3-contributor');
 assert.equal(buildBenchmarkMatrix({provider:'openrouter',modelIds:'a/b,a/b,c/d'}).include.length,2);
 assert.equal(buildBenchmarkMatrix({provider:'workers-ai',modelIds:'not-a-model'}).include.length,1);
});
test('invalid models and unbounded matrix expansion are rejected before real requests',()=>{
 assert.throws(()=>buildBenchmarkMatrix({provider:'openrouter',modelIds:'test/valid evil$(cmd)'}),/INVALID_OPENROUTER_MODEL/);
 assert.throws(()=>buildBenchmarkMatrix({provider:'openrouter',modelIds:'a/b,c/d,e/f,g/h,i/j,k/l,m/n'}),/MODEL_COUNT/);
 assert.throws(()=>buildBenchmarkMatrix({provider:'unknown'}),/INVALID_PROVIDER/);
});
test('compare reports preserves identities and treats absent model as missing, not failed cases',()=>{
 const matrix=buildBenchmarkMatrix({provider:'openrouter',modelIds:'a/b,c/d'});
 const report={setup:{tasksPerModel:20,repetitions:1},results:[{provider:'openrouter',model:'a/b',summary:{cases:20,passed:18}}]};
 const merged=mergeBenchmarkReports(matrix,{'0':report});
 assert.equal(merged.results.length,1);
 assert.equal(merged.missingModels.length,1);
 assert.equal(merged.missingModels[0].model,'c/d');
 assert.throws(()=>mergeBenchmarkReports(matrix,{'0':{results:[{provider:'openrouter',model:'c/d'}]}}),/MISMATCHED/);
});
