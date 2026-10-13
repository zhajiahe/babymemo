#!/usr/bin/env node
// Preserve compatible columns from the old importer, then apply the remaining
// additive 0016 schema and its history entry together. Never rebuild tables.
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const TARGET='0016_web_management.sql',PREVIOUS='0015_wechat_agent_rounds.sql';
export const VERSION_TABLES=['babies','growth_records','milestones','media'];
const source=()=>readFileSync(new URL('../migrations/'+TARGET,import.meta.url),'utf8');
export function mediaDescriptionPlan({columns,applied}){
 const target='0017_media_description.sql',tables=['media','media_uploads'];
 for(const table of tables){const c=columns[table]?.find(c=>c.name==='description');if(c&&(!/(?:TEXT|CHAR|CLOB)/i.test(c.type||'')||Number(c.pk||0)!==0||![null,undefined,"''",'""'].includes(c.dflt_value)))throw Error('MEDIA_DESCRIPTION_SCHEMA_MISMATCH')}
 if(applied.includes(target)){if(tables.some(t=>!columns[t]?.some(c=>c.name==='description')))throw Error('MEDIA_DESCRIPTION_MARKED_WITHOUT_COLUMN');return{decision:'verified',sql:''}}
 if(!applied.includes(TARGET)||!tables.some(t=>columns[t]?.some(c=>c.name==='description')))return{decision:'apply',sql:''};
 let sql=tables.filter(t=>!columns[t]?.some(c=>c.name==='description')).map(t=>"ALTER TABLE "+t+" ADD COLUMN description TEXT NOT NULL DEFAULT '';\n").join('');
 sql+=tables.map(t=>"UPDATE "+t+" SET description='' WHERE description IS NULL;").join('\n');
 sql+="\nINSERT INTO d1_migrations(name) VALUES('"+target+"');\n";return{decision:'reconcile',sql};
}
export function webManagementPlan({columns,applied,objects=[]}){
 const migration=source(),adds=[...migration.matchAll(/^ALTER TABLE (\w+) ADD COLUMN (\w+) ([^;]+);/gm)];
 for(const [,table,name] of adds){const column=columns[table]?.find(c=>c.name===name);if(column&&(!/(?:TEXT|CHAR|CLOB)/i.test(column.type||'')||Number(column.pk||0)!==0||![null,undefined,"''",'""'].includes(column.dflt_value)))throw Error('WEB_SCHEMA_MISMATCH:'+table+'.'+name)}
 if(applied.includes(TARGET)){
  if(adds.some(([,table,name])=>!columns[table]?.some(c=>c.name===name)))throw Error('WEB_MIGRATION_MARKED_WITHOUT_COLUMN');
  return{decision:'verified',sql:''};
 }
 if(!applied.includes(PREVIOUS))return{decision:'apply',sql:''};
 if(!adds.some(([,table,name])=>columns[table]?.some(c=>c.name===name)))return{decision:'apply',sql:''};
 if(objects.some(name=>name==='web_mutation_receipts'||/^(?:babies|growth_records|milestones|media)_(?:edit|initial)_version$/.test(name)))throw Error('UNTRACKED_WEB_SCHEMA_OBJECTS');
 let sql=migration.replace(/^ALTER TABLE (\w+) ADD COLUMN (\w+) [^;]+;/gm,(statement,table,name)=>columns[table]?.some(c=>c.name===name)?'':statement);
 const firstTrigger=sql.indexOf('CREATE TRIGGER');
 let normalization=VERSION_TABLES.map(table=>"UPDATE "+table+" SET updated_at='' WHERE updated_at IS NULL;").join('\n');
 if(columns.babies?.some(c=>c.name==='avatar_object_key'))normalization+="\nUPDATE babies SET avatar_key=avatar_object_key WHERE avatar_key='' AND avatar_object_key IS NOT NULL;";
 sql=sql.slice(0,firstTrigger)+normalization+'\n'+sql.slice(firstTrigger);
 // Legacy nullable columns have no default; old and new INSERT callers both
 // receive the same empty initial revision as a fresh 0016 database.
 for(const table of VERSION_TABLES)if(columns[table]?.some(c=>c.name==='updated_at'&&Number(c.notnull)===0))sql+="\nCREATE TRIGGER "+table+"_initial_version AFTER INSERT ON "+table+" WHEN NEW.updated_at IS NULL BEGIN UPDATE "+table+" SET updated_at='' WHERE id=NEW.id; END;\n";
 sql+="\nINSERT INTO d1_migrations(name) VALUES('"+TARGET+"');\n";
 return{decision:'reconcile',sql};
}
function query(args){
 const r=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--no-install','wrangler','d1','execute','DB','--remote','--json',...args],{encoding:'utf8',maxBuffer:4*1024*1024,env:{...process.env,CI:'true'}});
 if(r.status!==0||r.error)throw Error('WEB_SCHEMA_RECONCILE_FAILED');
 const output=r.stdout.trim();for(const at of [output.indexOf('['),output.indexOf('{')].filter(i=>i>=0)){try{const v=JSON.parse(output.slice(at)),rows=Array.isArray(v)?v:[v];if(rows.every(x=>x.success!==false))return rows.flatMap(x=>x.results||[])}catch{}}
 throw Error('D1_JSON_RESPONSE_INVALID');
}
export function reconcileWebManagement(){
 const applied=query(['--command','SELECT name FROM d1_migrations']).map(x=>x.name),columns={};
 for(const table of [...VERSION_TABLES,'media_uploads'])columns[table]=query(['--command','PRAGMA table_info('+table+')']);
 const objects=query(['--command',"SELECT name FROM sqlite_master WHERE type IN ('table','trigger')"]).map(x=>x.name);
 const plan=webManagementPlan({columns,applied,objects});
 const descriptions=mediaDescriptionPlan({columns,applied:plan.sql?[...applied,TARGET]:applied});
 const sql=plan.sql+'\n'+descriptions.sql;
 if(sql.trim()){const dir=mkdtempSync(join(tmpdir(),'babymemo-web-schema-'));try{const file=join(dir,'migration.sql');writeFileSync(file,sql,{mode:0o600});query(['--file',file])}finally{rmSync(dir,{recursive:true,force:true})}}
 console.log('[D1] web management migration: '+plan.decision);return plan.decision;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{reconcileWebManagement()}catch(e){console.error('[D1] '+(e instanceof Error?e.message:'RECONCILIATION_FAILED'));process.exitCode=1}}
