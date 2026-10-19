import type {Env} from './types';
import {streamZip,textEntry,type ZipEntry} from './stream-zip.mjs';
type Row=Record<string,unknown>;
export async function familySnapshot(env:Env){
 // All metadata reads share a single D1 transaction. Secrets, credentials and
 // authentication hashes are intentionally excluded from this user export.
  // Pending/failed uploads do not have guaranteed originals and must never make a complete archive fail.
 const [family,babies,growth,milestones,media,links]=await env.DB.batch<Row>([
  env.DB.prepare("SELECT value FROM app_settings WHERE name='family_name'"),
  env.DB.prepare('SELECT * FROM babies ORDER BY created_at'),
  env.DB.prepare('SELECT * FROM growth_records ORDER BY baby_id,day,created_at'),
  env.DB.prepare('SELECT * FROM milestones ORDER BY baby_id,day,created_at'),
  env.DB.prepare("SELECT * FROM media WHERE purge_token IS NULL AND upload_state='ready' ORDER BY baby_id,day,created_at"),
  env.DB.prepare("SELECT mm.* FROM milestone_media mm JOIN media m ON m.id=mm.media_id WHERE m.purge_token IS NULL AND m.upload_state='ready' ORDER BY milestone_id,media_id")
 ]);
 return {schema:'babymemo-family-export-v2',exportedAt:new Date().toISOString(),familyName:family.results[0]?.value||'家庭空间',babies:babies.results,growth:growth.results,milestones:milestones.results,media:media.results,milestoneMedia:links.results};
}
const extension=(mime:string)=>({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'}[mime]||'bin');
export async function familyExportManifest(env:Env){
 const snapshot=await familySnapshot(env),files:{id:string;kind:'avatar'|'original'|'thumbnail';path:string;size?:number}[]=[];
 for(const baby of snapshot.babies)if(baby.avatar_key)files.push({id:String(baby.id),kind:'avatar',path:'avatars/'+String(baby.id)+'.jpg'});
 for(const media of snapshot.media){files.push({id:String(media.id),kind:'original',path:'media/'+String(media.baby_id)+'/'+String(media.id)+'.'+extension(String(media.mime)),size:Number(media.size)});if(media.thumbnail_ready||media.thumbnail_object_key)files.push({id:String(media.id),kind:'thumbnail',path:'thumbnails/'+String(media.id)+'.jpg'})}
 return {snapshot,files};
}
export async function completeFamilyExport(env:Env){
 const snapshot=await familySnapshot(env),objects:{key:string;path:string;size:number}[]=[];
 for(const baby of snapshot.babies)if(baby.avatar_key)objects.push({key:String(baby.avatar_key),path:'avatars/'+String(baby.id)+'.jpg',size:-1});
 for(const media of snapshot.media){
  const id=String(media.id),baby=String(media.baby_id);
  objects.push({key:String(media.object_key),path:'media/'+baby+'/'+id+'.'+extension(String(media.mime)),size:Number(media.size)});
  if(media.thumbnail_ready||media.thumbnail_object_key)objects.push({key:String(media.thumbnail_object_key||'private/thumbnails/'+id+'.jpg'),path:'thumbnails/'+id+'.jpg',size:-1});
 }
 // Fail before headers for missing originals. Recheck each body when opening it;
 // a mid-download failure aborts the ZIP rather than silently exporting less.
 // Preflight metadata in bounded parallel lanes; never buffer original bytes.
 let next=0;
 await Promise.all(Array.from({length:Math.min(4,objects.length)},async()=>{
  while(next<objects.length){
   const object=objects[next++];
   const head=await env.MEDIA.head(object.key);
   if(!head||object.size>=0&&head.size!==object.size)throw Error('EXPORT_OBJECT_UNAVAILABLE');
   object.size=head.size;
  }
 }));
 const entries:ZipEntry[]=[textEntry('records.json',JSON.stringify(snapshot,null,2)),textEntry('manifest.json',JSON.stringify({schema:'babymemo-family-archive-v1',exportedAt:snapshot.exportedAt,objects},null,2)),
  textEntry('README.txt','BabyMemo complete family export\nrecords.json: baby profiles, growth, milestones, media metadata, archived/recycled items and milestone-media links.\nmedia/: original private photos and videos. avatars/: baby portraits. thumbnails/: existing derivatives. manifest.json maps R2 keys to archive paths.\nZIP CRC32 verifies file bytes. Keep this archive private. This user export excludes login hashes and API/WeChat secrets. For operational recovery use the operator SQL/R2 backup.\nMetadata is a D1 snapshot; R2 is streamed afterwards. Avoid editing/deleting media during export. An interrupted or failed archive must be downloaded again.\n')];
 for(const object of objects)entries.push({name:object.path,size:object.size,open:async()=>{const stored=await env.MEDIA.get(object.key);if(!stored||stored.size!==object.size)throw Error('EXPORT_OBJECT_UNAVAILABLE');return stored.body}});
 return streamZip(entries);
}
