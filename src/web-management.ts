import {Hono,type Context} from 'hono';
import type {ApplicationEnv} from './types';
import {validCalendarDay} from './validation';
import {commitMutation} from './web-mutations';

export const webManagement=new Hono<ApplicationEnv>();
const tables:Record<string,string>={growth:'growth_records',milestones:'milestones'};
const error=(c:Context<ApplicationEnv>,status:400|404|409|413|415,code:string)=>c.json({error:code},status);

webManagement.get('/records/:kind/:id',async c=>{
 const table=tables[c.req.param('kind')];if(!table)return error(c,404,'NOT_FOUND');
 const row=await c.env.DB.prepare('SELECT r.* FROM '+table+' r JOIN babies b ON b.id=r.baby_id WHERE r.id=? AND r.deleted_at IS NULL AND b.archived_at IS NULL').bind(c.req.param('id')).first();
 return row?c.json(row):error(c,404,'NOT_FOUND');
});
webManagement.get('/media/:id',async c=>{
 const row=await c.env.DB.prepare('SELECT id,baby_id,day,title,mime,size,thumbnail_ready,updated_at FROM media WHERE id=? AND deleted_at IS NULL AND purge_token IS NULL').bind(c.req.param('id')).first();
 return row?c.json(row):error(c,404,'NOT_FOUND');
});
webManagement.patch('/records/:kind/:id',async c=>{
 const table=tables[c.req.param('kind')];if(!table)return error(c,404,'NOT_FOUND');
 try{
  const raw=await c.req.text();if(raw.length>16384)return error(c,413,'BODY_TOO_LARGE');
  const v=JSON.parse(raw);
  if(!v||typeof v.babyId!=='string'||!validCalendarDay(v.day)||typeof v.expectedUpdatedAt!=='string')return error(c,400,'INVALID_RECORD');
  if(!await c.env.DB.prepare('SELECT id FROM babies WHERE id=? AND archived_at IS NULL').bind(v.babyId).first())return error(c,404,'INVALID_BABY');
  let sql:string,values:unknown[];const version=crypto.randomUUID();
  if(c.req.param('kind')==='growth'){
   const fields=[['weight',0.1,150],['height',10,250],['headCircumference',10,100]] as const;
   if(fields.every(([key])=>v[key]==null)||fields.some(([key,min,max])=>v[key]!=null&&(typeof v[key]!=='number'||!Number.isFinite(v[key])||v[key]<min||v[key]>max))||typeof v.notes!=='string'||v.notes.length>1500)return error(c,400,'INVALID_MEASUREMENTS');
   sql='UPDATE growth_records SET day=?,weight=?,height=?,head_circumference=?,notes=?';
   values=[v.day,v.weight??null,v.height??null,v.headCircumference??null,v.notes];
  }else{
   if(typeof v.title!=='string'||!v.title.trim()||v.title.length>120||typeof v.description!=='string'||v.description.length>3000)return error(c,400,'INVALID_TITLE');
   sql='UPDATE milestones SET day=?,title=?,description=?';values=[v.day,v.title.trim(),v.description];
  }
  const changes=await commitMutation(c,c.env.DB.prepare(sql+',updated_at=? WHERE id=? AND baby_id=? AND deleted_at IS NULL AND updated_at=?').bind(...values,version,c.req.param('id'),v.babyId,v.expectedUpdatedAt),{ok:true,updated_at:version});
  if(!changes){
   const row=await c.env.DB.prepare('SELECT id FROM '+table+' WHERE id=? AND baby_id=? AND deleted_at IS NULL').bind(c.req.param('id'),v.babyId).first();
   return error(c,row?409:404,row?'EDIT_CONFLICT':'NOT_FOUND');
  }
  return c.json({ok:true,updated_at:version});
 }catch{return error(c,400,'INVALID_INPUT')}
});

// Removing a baby archives the profile and its entire timeline without destroying
// any originals. The last active profile remains available to open the app.
webManagement.delete('/babies/:id',async c=>{
 const changes=await commitMutation(c,c.env.DB.prepare('UPDATE babies SET archived_at=? WHERE id=? AND archived_at IS NULL AND (SELECT COUNT(*) FROM babies WHERE archived_at IS NULL)>1').bind(new Date().toISOString(),c.req.param('id')));
 return changes?c.json({ok:true}):error(c,409,'KEEP_ONE_ACTIVE_BABY');
});
webManagement.get('/babies/archived/list',async c=>c.json({items:(await c.env.DB.prepare('SELECT id,name,archived_at FROM babies WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all()).results}));
webManagement.post('/babies/:id/restore',async c=>{
 const changes=await commitMutation(c,c.env.DB.prepare('UPDATE babies SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL').bind(c.req.param('id')));
 return changes?c.json({ok:true}):error(c,404,'NOT_FOUND');
});

webManagement.get('/babies/:id/avatar',async c=>{
 const row=await c.env.DB.prepare('SELECT avatar_key FROM babies WHERE id=? AND archived_at IS NULL').bind(c.req.param('id')).first<{avatar_key:string}>();
 if(!row?.avatar_key)return error(c,404,'NOT_FOUND');
 const object=await c.env.MEDIA.get(row.avatar_key);if(!object)return error(c,404,'NOT_FOUND');
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
});
webManagement.put('/babies/:id/avatar',async c=>{
 const requestId=c.req.header('X-Avatar-Id')||crypto.randomUUID();
 if(!/^[a-f0-9-]{36}$/i.test(requestId))return error(c,400,'INVALID_REQUEST_ID');
 const previous=await c.env.DB.prepare('SELECT path,response_json FROM web_mutation_receipts WHERE request_id=?').bind(requestId).first<{path:string;response_json:string}>();
 if(previous)return previous.path===c.req.path?c.json(JSON.parse(previous.response_json)):error(c,409,'REQUEST_ID_CONFLICT');
 const row=await c.env.DB.prepare('SELECT avatar_key,updated_at FROM babies WHERE id=? AND archived_at IS NULL').bind(c.req.param('id')).first<{avatar_key:string;updated_at:string}>();
 if(!row)return error(c,404,'NOT_FOUND');
 const expected=c.req.header('X-Expected-Version')??row.updated_at;
 if(expected!==row.updated_at)return error(c,409,'EDIT_CONFLICT');
 if(c.req.header('Content-Type')!=='image/jpeg')return error(c,415,'AVATAR_JPEG_REQUIRED');
 const reader=c.req.raw.body?.getReader();if(!reader)return error(c,400,'EMPTY_AVATAR');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();return error(c,413,'AVATAR_TOO_LARGE')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 if(size<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)return error(c,400,'INVALID_AVATAR');
 const version=crypto.randomUUID();
 const key='private/avatars/'+c.req.param('id')+'/'+version+'.jpg';
 await c.env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 const result=await c.env.DB.batch([
  c.env.DB.prepare('UPDATE babies SET avatar_key=?,updated_at=? WHERE id=? AND archived_at IS NULL AND updated_at=?').bind(key,version,c.req.param('id'),expected),
  c.env.DB.prepare('INSERT INTO web_mutation_receipts(request_id,path,method,payload_hash,response_json,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(requestId,c.req.path,'PUT','avatar',JSON.stringify({ok:true,updated_at:version}),new Date().toISOString())
 ]);
 if(!result[0].meta.changes){await c.env.MEDIA.delete(key);return error(c,409,'EDIT_CONFLICT')}
 if(row.avatar_key)await c.env.MEDIA.delete(row.avatar_key);
 return c.json({ok:true,updated_at:version});
});
webManagement.delete('/babies/:id/avatar',async c=>{
 const row=await c.env.DB.prepare('SELECT avatar_key,updated_at FROM babies WHERE id=? AND archived_at IS NULL').bind(c.req.param('id')).first<{avatar_key:string;updated_at:string}>();
 if(!row)return error(c,404,'NOT_FOUND');
 const raw=await c.req.text();let expected=row.updated_at;
 try{if(raw){const v=JSON.parse(raw);if(typeof v.expectedUpdatedAt!=='string')return error(c,400,'INVALID_INPUT');expected=v.expectedUpdatedAt}}catch{return error(c,400,'INVALID_INPUT')}
 const version=crypto.randomUUID();
 const changes=await commitMutation(c,c.env.DB.prepare("UPDATE babies SET avatar_key='',updated_at=? WHERE id=? AND updated_at=? AND archived_at IS NULL").bind(version,c.req.param('id'),expected),{ok:true,updated_at:version});
 if(!changes)return error(c,409,'EDIT_CONFLICT');
 if(row.avatar_key)await c.env.MEDIA.delete(row.avatar_key);
 return c.json({ok:true,updated_at:version});
});
