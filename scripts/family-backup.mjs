// Operator-only family archive. Does not modify any remote resources during export.
// Restore intentionally refuses original production resource names.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,statSync,chmodSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {readFile} from 'node:fs/promises';

const ROOT=resolve('.backup-private');
const WRANGLER=resolve('node_modules/wrangler/bin/wrangler.js');
const SOURCE_DB='babymemo',SOURCE_BUCKET='babymemo-media';
const sha256=data=>createHash('sha256').update(data).digest('hex');
function run(args,{json=false}={}){
  try{
    const value=execFileSync(process.execPath,[WRANGLER,...args],{
      encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000,stdio:['ignore','pipe','pipe']
    });
    return json?JSON.parse(value):value;
  }catch{throw Error('wrangler_failed_'+args[0]+'_'+args[1]);}
}
function rows(data){
  if(!Array.isArray(data))throw Error('unexpected_d1_json');
  const item=data.find(x=>Array.isArray(x.results));
  if(!item || item.success===false)throw Error('d1_query_failed');
  return item.results;
}
function query(database,sql){
  return rows(run(['d1','execute',database,'--remote','--json','--command',sql],{json:true}));
}
function withinPrivate(path){
  const full=resolve(path);
  if(!full.startsWith(ROOT+sep))throw Error('backup_path_must_be_inside_.backup-private');
  return full;
}
function safeMediaPath(key){
  if(typeof key!=='string'||!key.startsWith('private/')||key.includes('..')||key.includes('\\')||key.length>512)throw Error('invalid_media_key');
  return sha256(key).slice(0,32)+'.bin';
}
function verify(dir){
  const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
  if(manifest.schema!=='babymemo-full-backup-v1')throw Error('invalid_backup_schema');
  const sql=readFileSync(join(dir,'database.sql'));
  if(sha256(sql)!==manifest.database.sha256||sql.length!==manifest.database.size)throw Error('d1_checksum_mismatch');
  for(const item of manifest.objects){
    if(safeMediaPath(item.key)!==item.file)throw Error('invalid_manifest_filename');
    const bytes=readFileSync(join(dir,'media',item.file));
    if(bytes.length!==item.size||sha256(bytes)!==item.sha256)throw Error('media_checksum_mismatch');
  }
  if(new Set(manifest.objects.map(x=>x.key)).size!==manifest.objects.length)throw Error('duplicate_media_key');
  return manifest;
}
async function backup(dir){
  if(existsSync(dir))throw Error('backup_destination_already_exists');
  mkdirSync(join(dir,'media'),{recursive:true,mode:0o700});
  const dbFile=join(dir,'database.sql');
  run(['d1','export',SOURCE_DB,'--remote','--skip-confirmation','--output',dbFile]);
  chmodSync(dbFile,0o600);
  const fields=query(SOURCE_DB,'PRAGMA table_info(media)').map(x=>x.name);
  const thumbField=fields.includes('thumbnail_object_key')?',thumbnail_object_key':'';
  // A processing/failed placeholder has no guaranteed original in R2.
   // Back up its database state, but do not require a file that does not exist.
   const readyOnly=fields.includes('upload_state')?" WHERE upload_state='ready'":'';
   const media=query(SOURCE_DB,'SELECT id,object_key,thumbnail_ready'+thumbField+' FROM media'+readyOnly);
  let keys=media.flatMap(row=>[row.object_key,...(row.thumbnail_object_key?[row.thumbnail_object_key]:row.thumbnail_ready?['private/thumbnails/'+row.id+'.jpg']:[])]);
  const babyFields=query(SOURCE_DB,'PRAGMA table_info(babies)').map(x=>x.name);
  for(const column of ['avatar_key','avatar_object_key'])if(babyFields.includes(column)){
    keys.push(...query(SOURCE_DB,'SELECT '+column+' AS object_key FROM babies WHERE '+column+" IS NOT NULL AND "+column+"<>''").map(x=>x.object_key));
  }
  keys=[...new Set(keys)];
  const objects=[];
  for(const key of keys){
    const file=safeMediaPath(key),destination=join(dir,'media',file);
    run(['r2','object','get',SOURCE_BUCKET+'/'+key,'--remote','--file',destination]);
    chmodSync(destination,0o600);
    const bytes=readFileSync(destination);
    objects.push({key,file,size:bytes.length,sha256:sha256(bytes)});
  }
  const db=readFileSync(dbFile);
  const manifest={schema:'babymemo-full-backup-v1',exportedAt:new Date().toISOString(),database:{size:db.length,sha256:sha256(db)},objects};
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
  return verify(dir);
}
function stageLocal(dir,manifest){
  const state=join(dir,'isolated-restore');
  if(existsSync(state))throw Error('isolated_restore_already_exists');
  mkdirSync(state,{recursive:true,mode:0o700});
  run(['d1','execute','DB','--local','--persist-to',state,'--file',join(dir,'database.sql')]);
  for(const item of manifest.objects){
    run(['r2','object','put',SOURCE_BUCKET+'/'+item.key,'--local','--persist-to',state,'--file',join(dir,'media',item.file)]);
  }
}
function restoreRemote(dir,manifest,db,bucket,confirmation){
  if(!/^[a-zA-Z0-9_-]{2,80}$/.test(db)||!/^[a-z0-9-]{3,63}$/.test(bucket))throw Error('invalid_target');
  if(db===SOURCE_DB||bucket===SOURCE_BUCKET)throw Error('production_target_forbidden');
  if(confirmation!=='RESTORE_TO_NEW_ENVIRONMENT')throw Error('explicit_restore_confirmation_required');
  const existing=query(db,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if(existing.length)throw Error('target_database_is_not_empty');
  // R2 target bucket must be new and empty. Explicit acknowledgement is required;
  // Wrangler cannot enumerate it, so the operator must verify that separately.
  for(const item of manifest.objects){
    run(['r2','object','put',bucket+'/'+item.key,'--remote','--file',join(dir,'media',item.file)]);
  }
  run(['d1','execute',db,'--remote','--yes','--file',join(dir,'database.sql')]);
}
const [command,arg,targetDb,targetBucket,confirmation]=process.argv.slice(2);
if(!['export','verify','stage-local','restore-new-remote'].includes(command))throw Error('usage: node scripts/family-backup.mjs export|verify|stage-local|restore-new-remote <private-path> [new-db new-bucket RESTORE_TO_NEW_ENVIRONMENT]');
const directory=withinPrivate(arg||join('.backup-private',new Date().toISOString().replace(/[:.]/g,'-')));
if(command==='export'){
  const manifest=await backup(directory);
  process.stdout.write(JSON.stringify({exported:true,path:directory,media:manifest.objects.length})+'\n');
}else{
  const manifest=verify(directory);
  if(command==='stage-local')stageLocal(directory,manifest);
  if(command==='restore-new-remote')restoreRemote(directory,manifest,targetDb,targetBucket,confirmation);
  process.stdout.write(JSON.stringify({verified:true,command,media:manifest.objects.length})+'\n');
}
