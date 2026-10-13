import test from 'node:test';
import assert from 'node:assert/strict';
import {reconciliationDecision} from '../scripts/reconcile-birth-time.mjs';

const names=['babies','d1_migrations'];
const complete={name:'birth_time',type:'TEXT',notnull:1,dflt_value:"''"};
const previous=['0001_initial.sql','0011_wechat_photo.sql'];
const fixture=(o={})=>({tables:names,columns:[complete],applied:previous,...o});

test('legacy column plus verified prior migration safely repairs only tracking',()=>{
  assert.equal(reconciliationDecision(fixture()),'reconcile');
  assert.equal(reconciliationDecision(fixture({applied:[...previous,'0012_birth_time.sql']})),'verified');
});
test('fresh databases and absent birth_time use normal Wrangler migration',()=>{
  assert.equal(reconciliationDecision(fixture({tables:[],columns:[],applied:[]})),'apply');
  assert.equal(reconciliationDecision(fixture({columns:[]})),'apply');
});
test('drift with missing prerequisite is never silently marked applied',()=>{
  assert.throws(()=>reconciliationDecision(fixture({applied:['0001_initial.sql']})),/MISSING_PREVIOUS/);
  assert.throws(()=>reconciliationDecision(fixture({tables:['babies']})),/MISSING_MIGRATION_HISTORY/);
});
test('accept earlier nullable TEXT definitions with no default or empty default',()=>{
  assert.equal(reconciliationDecision(fixture({columns:[{...complete,notnull:0,dflt_value:null}]})),'reconcile');
  assert.equal(reconciliationDecision(fixture({columns:[{...complete,type:'VARCHAR(5)',notnull:0,dflt_value:'""'}]})),'reconcile');
});
test('refuse non-text fields, nonempty defaults or primary-key drift',()=>{
  for(const change of [{type:'INTEGER'},{type:'BLOB'},{dflt_value:"'unknown'"},{pk:1}]){
    assert.throws(()=>reconciliationDecision(fixture({columns:[{...complete,...change}]})),/SCHEMA_MISMATCH/);
  }
});
test('migration history cannot claim a nonexistent column or table',()=>{
  assert.throws(()=>reconciliationDecision(fixture({columns:[],applied:[...previous,'0012_birth_time.sql']})),/MARKED_WITHOUT_COLUMN/);
  assert.throws(()=>reconciliationDecision(fixture({tables:['d1_migrations'],columns:[],applied:[...previous,'0012_birth_time.sql']})),/MARKED_WITHOUT_BABIES/);
});
