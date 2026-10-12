/**
 * Scheduled cleanup of abandoned upload parts in small bounded batches.
 * A completed object is recoverable family data, so reconcile its D1 record
 * instead of deleting it. Failures leave the session for the next Cron run.
 */
export async function cleanupExpiredUploads({env,olderThan,limit=30,finalizeUpload}) {
  const rows=await env.DB.prepare(
    'SELECT * FROM media_uploads WHERE COALESCE(updated_at,created_at) < ? ORDER BY COALESCE(updated_at,created_at),id LIMIT ?'
  ).bind(olderThan,limit).all();
  const result={scanned:rows.results.length,aborted:0,recovered:0,skipped:0,errors:0};
  for(const row of rows.results) {
    try {
      // Recheck immediately so a recently resumed upload is not purged.
      const current=await env.DB.prepare(
        'SELECT id FROM media_uploads WHERE id=? AND COALESCE(updated_at,created_at) < ?'
      ).bind(row.id,olderThan).first();
      if(!current){result.skipped++;continue;}
      const recorded=async()=>Boolean(await env.DB.prepare('SELECT id FROM media WHERE id=?').bind(row.id).first());
      if(await recorded()){
        await env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(row.id).run();
        result.recovered++;
        continue;
      }
      const obj=await env.MEDIA.head(row.object_key);
      if(obj) {
        if(obj.size!==row.size){result.errors++;continue;}
        const parts=await env.DB.prepare(
          'SELECT part_number AS partNumber,etag FROM media_upload_parts WHERE media_upload_id=? ORDER BY part_number'
        ).bind(row.id).all();
        const expected=Math.ceil(row.size/8388608);
        if(parts.results.length!==expected){result.errors++;continue;}
        await finalizeUpload({bucket:env.MEDIA,row,parts:parts.results,
          isRecorded:recorded,
          persist:()=>env.DB.batch([
            env.DB.prepare('INSERT INTO media(id,baby_id,day,title,object_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)')
              .bind(row.id,row.baby_id,row.day,row.title,row.object_key,row.mime,row.size,row.created_at),
            env.DB.prepare('DELETE FROM media_uploads WHERE id=?').bind(row.id)
          ])
        });
        result.recovered++;
        continue;
      }
      // Abort before removing the D1 session; if R2 is unavailable, retry later.
      try {
        await env.MEDIA.resumeMultipartUpload(row.object_key,row.upload_id).abort();
      } catch (error) {
        // Never discard metadata if R2 completed during a concurrent finish.
        if(await env.MEDIA.head(row.object_key)){result.skipped++;continue;}
        throw error;
      }
      await env.DB.prepare(
        'DELETE FROM media_uploads WHERE id=? AND COALESCE(updated_at,created_at) < ?'
      ).bind(row.id,olderThan).run();
      result.aborted++;
    } catch {result.errors++}
  }
  return result;
}
