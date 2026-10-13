import type {Env} from './types';

export type WechatConnection = {
 id:string; label:string; bot_id:string; user_id:string; token_cipher:string;
 base_url:string; enabled:number; created_at:string; updated_at:string;
};
export type PublicWechatConnection = {
 id:string; label:string; enabled:boolean; createdAt:string; updatedAt:string;
};

export async function getWechatConnection(env:Env,id:string):Promise<WechatConnection|null>{
 return await env.DB.prepare('SELECT * FROM wechat_connections WHERE id=?').bind(id).first<WechatConnection>() || null;
}
export async function listWechatConnections(env:Env):Promise<PublicWechatConnection[]>{
 const rows=await env.DB.prepare('SELECT id,label,enabled,created_at,updated_at FROM wechat_connections ORDER BY created_at,id').all<Pick<WechatConnection,'id'|'label'|'enabled'|'created_at'|'updated_at'>>();
 return rows.results.map(r=>({id:r.id,label:r.label,enabled:r.enabled===1,createdAt:r.created_at,updatedAt:r.updated_at}));
}
