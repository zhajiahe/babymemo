import type {Env} from './types';
export const retentionCutoff=(at:number=Date.now())=>new Date(at-30*86400000).toISOString();

// A D1 claim linearizes restore vs purge. Once claimed, no writer may restore
// the row. Failed R2 deletions keep the claim for the next scheduled retry.
export async function purgeDeletedMedia(env:Env,at:number=Date.now()){
 const cutoff=retentionCutoff(at);
 const rows=await env.DB.prepare('SELECT id FROM media WHERE deleted_at IS NOT NULL AND deleted_at<? ORDER BY deleted_at LIMIT 30').bind(cutoff).all<{id:string}>();
 for(const row of rows.results){
  const claimed=await env.DB.prepare('UPDATE media SET purge_token=COALESCE(purge_token,?) WHERE id=? AND deleted_at IS NOT NULL AND deleted_at<? RETURNING id,object_key,purge_token')
   .bind(crypto.randomUUID(),row.id,cutoff).first<{id:string;object_key:string;purge_token:string}>();
  if(!claimed)continue;
  await env.MEDIA.delete([claimed.object_key,'private/thumbnails/'+claimed.id+'.jpg']);
  await env.DB.prepare('DELETE FROM media WHERE id=? AND purge_token=?').bind(claimed.id,claimed.purge_token).run();
 }
}
