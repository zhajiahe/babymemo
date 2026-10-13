// D1-backed operation journal. No SQL or record IDs may originate from free-form LLM text.
const TABLES={growth:'growth_records',milestones:'milestones',media:'media',baby:'babies'};
const COLUMNS={
 growth:['weight','height','head_circumference','notes','day','deleted_at'],
 milestones:['day','title','description','deleted_at'],
 media:['day','favorite','deleted_at'],
 baby:['name','birthday','birth_time','allergies','notes']
};
export function operationSnapshot(kind,row){
 if(!row)return null;
 return Object.fromEntries((COLUMNS[kind]||[]).map(k=>[k,row[k]??null]));
}
const key=(kind,id)=>{if(!TABLES[kind]||typeof id!=='string')throw Error('INVALID_OPERATION_TARGET');return TABLES[kind]};
export async function auditChange(env,{sourceId,babyId,kind,recordId,action,before,after,statement}){
 key(kind,recordId);
 const opId=crypto.randomUUID(),when=new Date().toISOString();
 const insert=env.DB.prepare('INSERT OR IGNORE INTO wechat_operation_log(id,source_message_id,baby_id,kind,record_id,action,before_json,after_json,created_at) '+
  (statement?'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0':'VALUES(?,?,?,?,?,?,?,?,?)'))
 .bind(opId,sourceId||opId,babyId,kind,recordId,action,JSON.stringify(before),JSON.stringify(after),when);
 // D1 batch is a transaction: a failed log insertion must not leave an untracked edit.
 if(statement){
  if(typeof env.DB.batch!=='function')throw Error('AUDIT_TRANSACTION_UNAVAILABLE');
  const results=await env.DB.batch([statement,insert]);
  if(!results[0]?.meta?.changes)return null;
 }else await insert.run();
 const actual=await env.DB.prepare('SELECT id FROM wechat_operation_log WHERE source_message_id=? AND baby_id=? LIMIT 1')
  .bind(sourceId||opId,babyId).first();
 return actual?.id||opId;
}
export async function undoOperation(env,babyId,opId){
 if(!opId||typeof opId!=='string')return '没有可撤销的最近操作';
 const op=await env.DB.prepare('SELECT * FROM wechat_operation_log WHERE id=? AND baby_id=? AND undone_at IS NULL LIMIT 1').bind(opId,babyId).first();
 if(!op)return '这项操作不存在或已撤销，请重新查询';
 const table=key(op.kind,op.record_id),allowed=COLUMNS[op.kind];
 let before,after;
 try{before=JSON.parse(op.before_json);after=JSON.parse(op.after_json)}catch{return '操作历史无法解析，未做任何修改'}
 const current=await env.DB.prepare('SELECT * FROM '+table+' WHERE id=? AND '+(op.kind==='baby'?'id=?':'baby_id=?')+' LIMIT 1').bind(op.record_id,op.kind==='baby'?babyId:babyId).first();
 if(!current)return '记录已不存在，不能撤销';
 const expected=after||{};
 if(Object.keys(expected).some(k=>!allowed.includes(k)||JSON.stringify(current[k]??null)!==JSON.stringify(expected[k]??null)))
  return '记录已经被其他操作修改，不能直接撤销，请手动检查';
 const values=before===null?{deleted_at:new Date().toISOString()}:before;
 if(Object.keys(values).some(k=>!allowed.includes(k)))return '操作历史字段不受支持，未做任何修改';
 const keys=Object.keys(values);
 if(!keys.length)return '没有可撤销的字段';
 const conditional=Object.keys(expected).map(k=>k+' IS ?').join(' AND ');
 const update=env.DB.prepare('UPDATE '+table+' SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=? AND '+(op.kind==='baby'?'id=?':'baby_id=?')+(conditional?' AND '+conditional:''))
 .bind(...keys.map(k=>values[k]),op.record_id,babyId,...Object.keys(expected).map(k=>expected[k]));
 const mark=env.DB.prepare('UPDATE wechat_operation_log SET undone_at=? WHERE id=? AND undone_at IS NULL AND changes()>0').bind(new Date().toISOString(),op.id);
 if(typeof env.DB.batch!=='function')throw Error('AUDIT_TRANSACTION_UNAVAILABLE');
 const result=await env.DB.batch([update,mark]);
 return result[0]?.meta?.changes?'已撤销最近一次操作（'+op.kind+'，编号 '+op.record_id.slice(0,8)+'）。':'记录发生变化，未撤销';
}
export function snapshotChanges(kind,before,changes){
 return {...operationSnapshot(kind,before),...changes};
}
