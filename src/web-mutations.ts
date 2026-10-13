import type {Context} from 'hono';
import type {ApplicationEnv} from './types';
type Ctx=Context<ApplicationEnv>;
export const queueablePath=(path:string)=>/^\/api\/(?:records\/(?:growth|milestones)(?:\/[^/]+)?|babies(?:\/[^/]+(?:\/(?:restore|avatar))?)?|media\/[^/]+|trash\/(?:growth|milestones|media)\/[^/]+\/restore)$/.test(path);
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export async function mutationIdentity(c:Ctx){
 const cached=c.get('mutationIdentity');if(cached!==undefined)return cached;
 const id=c.req.header('X-Request-Id');
 if(!id||!queueablePath(c.req.path))return null;
 if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('INVALID_REQUEST_ID');
 const text=await c.req.raw.clone().text();if(text.length>16384)throw Error('BODY_TOO_LARGE');
 const identity={id,path:c.req.path,method:c.req.method,hash:await digest(text)};c.set('mutationIdentity',identity);return identity;
}
export async function previousMutation(c:Ctx){
 const identity=await mutationIdentity(c);if(!identity)return null;
 const saved=await c.env.DB.prepare('SELECT path,method,payload_hash,response_json FROM web_mutation_receipts WHERE request_id=?').bind(identity.id).first<{path:string;method:string;payload_hash:string;response_json:string}>();
 if(!saved)return null;
 if(saved.path!==identity.path||saved.method!==identity.method||saved.payload_hash!==identity.hash)throw Error('REQUEST_ID_CONFLICT');
 return JSON.parse(saved.response_json);
}
// The receipt and business write share one D1 transaction. Network-response loss
// can be retried even after another client has made a later edit.
export async function commitMutation(c:Ctx,statement:D1PreparedStatement,response:object={ok:true}){
 const identity=await mutationIdentity(c);
 if(!identity)return (await statement.run()).meta.changes;
 const result=await c.env.DB.batch([
  statement,
  c.env.DB.prepare('INSERT INTO web_mutation_receipts(request_id,path,method,payload_hash,response_json,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0')
   .bind(identity.id,identity.path,identity.method,identity.hash,JSON.stringify(response),new Date().toISOString())
 ]);
 return result[0].meta.changes;
}
