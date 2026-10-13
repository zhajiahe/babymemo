#!/usr/bin/env node
/**
 * Reconcile a single legacy schema drift in D1: birth_time exists in babies
 * but Wrangler never recorded 0012_birth_time.sql.
 *
 * This script never alters babies or touches family records. It records that
 * one migration ONLY after verifying a compatible existing TEXT-affinity
 * column and the preceding migration. Other drifts fail closed.
 */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const TARGET='0012_birth_time.sql';
const PREVIOUS='0011_wechat_photo.sql';

export function reconciliationDecision({tables,columns,applied}){
  const hasBabies=tables.includes('babies');
  const hasHistory=tables.includes('d1_migrations');
  const exists=columns.find(row=>row.name==='birth_time');
  if(!hasBabies){
    if(hasHistory && applied.includes(TARGET))throw Error('MIGRATION_MARKED_WITHOUT_BABIES');
    return 'apply';
  }
  if(!exists){
    if(applied.includes(TARGET))throw Error('MIGRATION_MARKED_WITHOUT_COLUMN');
    return 'apply';
  }
  const type=String(exists.type||'').toUpperCase().trim();
  // Earlier deployments could have created a nullable TEXT birth_time before
  // 0012 existed. Every application INSERT explicitly provides birth_time;
  // both nullable/no-default and NOT NULL/empty-default are compatible here.
  const textAffinity=/(?:TEXT|CHAR|CLOB)/.test(type);
  const nullable=[0,1].includes(Number(exists.notnull));
  const defaultIsEmpty=[null,undefined,"''",'""'].includes(exists.dflt_value);
  if(!textAffinity||!nullable||!defaultIsEmpty||Number(exists.pk||0)!==0){
    const shape=JSON.stringify({type,notnull:exists.notnull,default:exists.dflt_value,pk:exists.pk});
    throw Error('BIRTH_TIME_SCHEMA_MISMATCH: incompatible existing birth_time column '+shape);
  }
  if(!hasHistory)throw Error('MISSING_MIGRATION_HISTORY: refusing to create history automatically');
  if(applied.includes(TARGET))return 'verified';
  if(!applied.includes(PREVIOUS))
    throw Error('MISSING_PREVIOUS_MIGRATION: refusing to skip unverified D1 history');
  return 'reconcile';
}

function extractResults(output){
  const source=output.trim();
  // Some Wrangler versions prepend progress banners before a JSON payload.
  const offsets=[source.indexOf('['),source.indexOf('{')].filter(x=>x>=0).sort((a,b)=>a-b);
  for(const offset of offsets){
    try{
      const json=JSON.parse(source.slice(offset));
      const entries=Array.isArray(json)?json:[json];
      const results=entries.flatMap(x=>Array.isArray(x?.results)?x.results:[]);
      if(entries.length&&entries.every(x=>x?.success!==false))return results;
    }catch{}
  }
  throw Error('D1_JSON_RESPONSE_INVALID');
}
function wrangler(sql){
  const cli=process.platform==='win32'?'npx.cmd':'npx';
  const result=spawnSync(cli,['--no-install','wrangler','d1','execute','DB','--remote','--json','--command',sql],{
    cwd:process.cwd(),encoding:'utf8',maxBuffer:4*1024*1024,env:{...process.env,CI:'true'}
  });
  if(result.error||result.status!==0)throw Error('D1_INSPECTION_FAILED: '+(result.stderr||String(result.error)).slice(-500));
  return extractResults(result.stdout);
}
export function reconcileBirthTime(){
  const tables=wrangler("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('babies','d1_migrations')").map(x=>x.name);
  const columns=tables.includes('babies')?wrangler("PRAGMA table_info('babies')"):[];
  const applied=tables.includes('d1_migrations')?
    wrangler('SELECT name FROM d1_migrations').map(x=>x.name):[];
  const decision=reconciliationDecision({tables,columns,applied});
  if(decision==='reconcile'){
    // Recording an already-applied schema change is not a DDL migration.
    // Strict guards above keep unknown D1 drift out of this recovery path.
    wrangler("INSERT INTO d1_migrations (name) SELECT '"+TARGET+"' WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name='"+TARGET+"')");
    const recorded=wrangler("SELECT name FROM d1_migrations WHERE name='"+TARGET+"'");
    if(recorded.length!==1)throw Error('D1_MIGRATION_RECONCILIATION_NOT_CONFIRMED');
  }
  console.log('[D1] birth_time migration: '+decision+
    (decision==='reconcile'?' (schema verified; repaired history only)':' (no schema changes)'));
  return decision;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{reconcileBirthTime()}
  catch(e){console.error('[D1] '+(e instanceof Error?e.message:String(e)));process.exitCode=1}
}
