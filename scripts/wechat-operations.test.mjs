import test from 'node:test';
import assert from 'node:assert/strict';
import {auditChange,operationSnapshot,undoOperation} from '../src/wechat-operations.mjs';
function fake(){
 const row={id:'aaaaaaaa-1111-2222-3333-444444444444',baby_id:'b1',day:'2026-10-01',weight:10,height:80,head_circumference:45,notes:'',deleted_at:null};
 const logs=new Map(),calls=[];
 const DB={prepare(sql){
  let args=[];
  const task={bind(...values){args=values;return this},
   async first(){
    if(sql.includes('FROM wechat_operation_log')){
     const logsAll=[...logs.values()];
     if(sql.includes('WHERE id='))return logsAll.find(x=>x.id===args[0]&&x.baby_id===args[1]&&!x.undone_at)||null;
     return logsAll.find(x=>x.source_message_id===args[0]&&x.baby_id===args[1])||null;
    }
    if(sql.includes('FROM growth_records'))return {...row};
    return null;
   },
   async run(){
    calls.push({sql,args});
    if(sql.startsWith('UPDATE growth_records')){
     if(sql.includes('SET weight'))row.weight=args[0];
     else if(sql.includes('SET deleted_at'))row.deleted_at=args[0];
     else return {meta:{changes:0}};
     return {meta:{changes:1}};
    }
    if(sql.startsWith('INSERT OR IGNORE INTO wechat_operation_log')){
     const [id,source_message_id,baby_id,kind,record_id,action,before_json,after_json,created_at]=args;
     if(![...logs.values()].some(x=>x.source_message_id===source_message_id))
      logs.set(id,{id,source_message_id,baby_id,kind,record_id,action,before_json,after_json,created_at,undone_at:null});
     return {meta:{changes:1}};
    }
    if(sql.startsWith('UPDATE wechat_operation_log')){
     const op=logs.get(args[1]);if(op)op.undone_at=args[0];
     return {meta:{changes:op?1:0}};
    }
    return {meta:{changes:1}};
   }};
  return task;
 },async batch(statements){
  const out=[];for(const s of statements)out.push(await s.run());return out;
 }};
 return {DB,row,logs,calls};
}
test('audited update persists before/after and restores original value',async()=>{
 const env=fake(),before=operationSnapshot('growth',env.row);
 const stmt=env.DB.prepare('UPDATE growth_records SET weight=? WHERE id=?').bind(10.5,env.row.id);
 const opId=await auditChange(env,{sourceId:'stepA',babyId:'b1',kind:'growth',recordId:env.row.id,
  action:'update',before,after:{...before,weight:10.5},statement:stmt});
 assert.equal(env.row.weight,10.5);
 assert.equal(env.logs.size,1);
 assert.match(await undoOperation(env,'b1',opId),/已撤销/);
 assert.equal(env.row.weight,10);
 assert.equal((await undoOperation(env,'b1',opId)).includes('已撤销'),false);
});
test('undo refuses a record that changed again after the target operation',async()=>{
 const env=fake(),before=operationSnapshot('growth',env.row);
 const stmt=env.DB.prepare('UPDATE growth_records SET weight=? WHERE id=?').bind(10.5,env.row.id);
 const opId=await auditChange(env,{sourceId:'stepB',babyId:'b1',kind:'growth',recordId:env.row.id,
  action:'update',before,after:{...before,weight:10.5},statement:stmt});
 env.row.weight=11;
 assert.match(await undoOperation(env,'b1',opId),/其他操作修改/);
 assert.equal(env.row.weight,11);
});
