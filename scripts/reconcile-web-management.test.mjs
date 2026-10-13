import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {webManagementPlan,VERSION_TABLES} from './reconcile-web-management.mjs';
const columns=Object.fromEntries(VERSION_TABLES.map(t=>[t,[{name:'updated_at',type:'TEXT',notnull:0,dflt_value:null,pk:0}]]));
columns.babies.push({name:'avatar_object_key',type:'TEXT',notnull:0,dflt_value:null});
const legacy=()=>webManagementPlan({columns,applied:['0015_wechat_agent_rounds.sql']});
test('compatible imported revisions are retained without duplicate ALTERs or rebuilt tables',()=>{
 const plan=legacy();assert.equal(plan.decision,'reconcile');assert.doesNotMatch(plan.sql,/ADD COLUMN updated_at|DROP TABLE|DELETE FROM/);
 const schema="CREATE TABLE d1_migrations(name TEXT);"+VERSION_TABLES.map(t=>`CREATE TABLE ${t}(id TEXT PRIMARY KEY,updated_at TEXT${t==='babies'?',avatar_object_key TEXT':''}); INSERT INTO ${t}(id) VALUES('old');`).join('')+"UPDATE babies SET avatar_object_key='private/legacy.jpg'; UPDATE media SET updated_at='retained-version';";
 const verify="\nassert db.execute('select avatar_key from babies').fetchone()[0]=='private/legacy.jpg'\nassert db.execute('select updated_at from media').fetchone()[0]=='retained-version'\nfor table in ['babies','growth_records','milestones','media']:\n db.execute('insert into '+table+'(id) values(?)',['new'])\n assert db.execute('select updated_at from '+table+' where id=?',['new']).fetchone()[0]==''\nassert db.execute('select name from d1_migrations').fetchone()[0]=='0016_web_management.sql'\n";
 const r=spawnSync('python3',['-c','import sqlite3,sys\ndb=sqlite3.connect(":memory:")\ndb.executescript(sys.stdin.read())'+verify],{input:schema+plan.sql,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('fresh schemas keep the normal migration path; incompatible columns fail closed',()=>{
 assert.equal(webManagementPlan({columns:{},applied:['0015_wechat_agent_rounds.sql']}).decision,'apply');
 assert.throws(()=>webManagementPlan({columns:{...columns,media:[{name:'updated_at',type:'INTEGER'}]},applied:['0015_wechat_agent_rounds.sql']}),/SCHEMA_MISMATCH/);
 assert.throws(()=>webManagementPlan({columns:{},applied:['0016_web_management.sql']}),/MARKED_WITHOUT_COLUMN/);
 assert.throws(()=>webManagementPlan({columns,applied:['0015_wechat_agent_rounds.sql'],objects:['web_mutation_receipts']}),/UNTRACKED/);
});
