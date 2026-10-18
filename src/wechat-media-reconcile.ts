import type {Env} from './types';

export type MediaReconcileStats={scanned:number;recovered:number;failed:number;skipped:number;errors:number};

/**
 * Repair orphaned WeChat reservations after the durable queue has had a full
 * day to retry. A complete R2 object is authoritative; a reserved D1 row alone
 * is never proof that a photo or video exists.
 *
 * The conditional UPDATE checks activity again after R2 HEAD, so a concurrent
 * upload/metadata edit never gets overwritten. Originals are never deleted.
 */
export async function reconcileStaleWechatMedia(env:Pick<Env,'DB'|'MEDIA'>,cutoff:string,limit=20):Promise<MediaReconcileStats>{
 const candidates=await env.DB.prepare(
  "SELECT id,baby_id,object_key,mime FROM media WHERE upload_state='processing' AND source_message_id IS NOT NULL AND deleted_at IS NULL AND purge_token IS NULL AND COALESCE(NULLIF(updated_at,''),created_at)<? ORDER BY created_at,id LIMIT ?"
 ).bind(cutoff,limit).all<{id:string;baby_id:string;object_key:string;mime:string}>();
 const stats={scanned:candidates.results.length,recovered:0,failed:0,skipped:0,errors:0};
 for(const row of candidates.results){
  try{
   const original=await env.MEDIA.head(row.object_key);
   const mime=original?.httpMetadata?.contentType;
   const expectedKind=row.mime.startsWith('video/')?'video/':'image/';
   const trusted=original&&Number.isSafeInteger(original.size)&&original.size>0&&original.size<=50*1024*1024&&
    typeof mime==='string'&&mime.startsWith(expectedKind);
   const ready=Boolean(trusted);
   // Only the verified original may become ready. Preserve all family edits,
   // including description, day and title. Bad/absent objects become retryable
   // failures in the UI; any existing R2 bytes remain untouched.
   let cover=0;
   if(ready)cover=Number(Boolean(await env.MEDIA.head('private/thumbnails/'+row.id+'.jpg')));
   const changed=ready
    ?await env.DB.prepare(
      "UPDATE media SET mime=?,size=?,thumbnail_ready=?,upload_state='ready' WHERE id=? AND baby_id=? AND upload_state='processing' AND deleted_at IS NULL AND purge_token IS NULL AND COALESCE(NULLIF(updated_at,''),created_at)<?"
     ).bind(mime,original!.size,cover,row.id,row.baby_id,cutoff).run()
    :await env.DB.prepare(
      "UPDATE media SET upload_state='failed' WHERE id=? AND baby_id=? AND upload_state='processing' AND deleted_at IS NULL AND purge_token IS NULL AND COALESCE(NULLIF(updated_at,''),created_at)<?"
     ).bind(row.id,row.baby_id,cutoff).run();
   if(!changed.meta.changes)stats.skipped++;
   else if(ready)stats.recovered++;
   else stats.failed++;
  }catch{stats.errors++}
 }
 return stats;
}
