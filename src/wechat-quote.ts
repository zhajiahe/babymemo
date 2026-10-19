import type {Env} from './types';
import type {ParsedWechatIncoming} from './wechat-forward';

/** Resolve a WeChat quoted upload only by its original platform message ID.
 * A nearby upload, filename, chat title or model guess is NOT a durable identity.
 */
export async function resolveWechatQuotedMedia(
 env:Env,babyId:string,botId:string,parsed:ParsedWechatIncoming
):Promise<{id:string;kind:'image'|'video';uploadState:string;day:string;title:string|null}|null>{
 if(!parsed.quoted||!parsed.quotedMessageId||!parsed.quotedMediaKind||!botId)return null;
 const raw=parsed.quotedMessageId;
 if(raw.length>128||! /^[\w:.-]+$/.test(raw))return null;
 const source=raw.startsWith(botId+':')?raw:botId+':'+raw;
 const kind=parsed.quotedMediaKind;
 const exact=Array.from({length:4},(_,i)=>source+':'+kind+':'+i);
 const rows=await env.DB.prepare(
  'SELECT id,title,day,upload_state,deleted_at,purge_token FROM media WHERE baby_id=? AND deleted_at IS NULL AND source_message_id IN ('+
  exact.map(()=>'?').join(',')+') LIMIT 5'
 ).bind(babyId,...exact).all<{id:string;title:string|null;day:string;upload_state:string;deleted_at:string|null;purge_token:string|null}>();
 if(rows.results.length!==1||rows.results[0].purge_token)return null;
 const row=rows.results[0];
 if(!['ready','processing'].includes(row.upload_state||'ready'))return null;
 return {id:row.id,kind,uploadState:row.upload_state||'ready',day:row.day,title:row.title||null};
}
