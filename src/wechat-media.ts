import type {Env} from './types';
import {r2PhotoCaptureDay,validCaptureDay} from './media-date.mjs';
import {mediaTiming} from './media-timing.mjs';
import {MAX_ITEMS,bad,mediaItems,photoRecordId,type WechatMediaItem} from './wechat-media-codec';
import {storeEncryptedMedia,downloadWeChatImage,type MediaTransferOptions} from './wechat-media-transfer';
export {MAX_WECHAT_MEDIA_BYTES,MAX_WECHAT_IMAGE_BYTES,WechatPhotoError,wechatMediaErrorCode,decodeWeChatAesKey,wechatCdnUrl,imageReference,mediaReference,inspectImage,inspectVideo,mediaItems,photoItems,videoItems,photoRecordId} from './wechat-media-codec';
export {downloadWeChatImage,downloadWeChatVideo,storeEncryptedMedia} from './wechat-media-transfer';
type RawMessage={create_time_ms?:unknown;item_list?:WechatMediaItem[]};
type BabyContext={id:string;name:string;time_zone?:string};
function localDay(raw:RawMessage,baby:BabyContext){
 const ts=Number(raw.create_time_ms);
 const date=Number.isFinite(ts)&&ts>1500000000000&&ts<Date.now()+86400000?new Date(ts):new Date();
 try{return date.toLocaleDateString('sv-SE',{timeZone:baby.time_zone||'Asia/Shanghai'})}
 catch{return date.toISOString().slice(0,10)}
}
export async function persistWeChatMedia(env:Env,raw:RawMessage,baby:BabyContext,messageId:string,options:MediaTransferOptions={}){
 const items=mediaItems(raw);
 if(!items.length)return null;
 if(items.length>MAX_ITEMS)bad('单条消息最多保存 4 项媒体，请分批发送');
 const result:{id:string;kind:'image'|'video';already:boolean}[]=[];
 async function persistItem(i:number){
  const itemStartedAt=performance.now();
  const kind=items[i].type===5?'video':'image';
  const sourceId=messageId+':'+kind+':'+i,id=photoRecordId(sourceId);
  const existing=await env.DB.prepare('SELECT id,deleted_at FROM media WHERE source_message_id=?').bind(sourceId).first<{id:string;deleted_at?:string|null}>();
  if(existing)return {id:existing.id,kind,already:true};
  const objectKey='private/'+baby.id+'/'+id;
  const old=await env.MEDIA.head(objectKey);
  let size=old?.size||0,mime=old?.httpMetadata?.contentType;
  if(!old){
   const saved=await storeEncryptedMedia(env.MEDIA,objectKey,items[i],options);
   size=saved.size;mime=saved.mime;
  }
  if(typeof mime!=='string'||!mime.startsWith(kind+'/'))throw Error('WECHAT_MEDIA_MIME_MISMATCH');
  // Read the privately stored original, including HEIC EXIF extents near EOF.
  // Range reads are bounded; retries reuse R2 and never rewrite the original.
  const captured=kind==='image'?await r2PhotoCaptureDay(env.MEDIA,objectKey,size,mime,baby.time_zone||'Asia/Shanghai'):null;
  const day=validCaptureDay(captured,baby.time_zone||'Asia/Shanghai')||localDay(raw,baby);
  const caption=(raw.item_list??[]).filter(x=>x?.type===1&&typeof x.text_item?.text==='string')
    .map(x=>x.text_item.text).join(' ').trim().slice(0,1000);
  const title=caption.slice(0,120)||(kind==='video'?'微信视频 ':'微信照片 ')+day;
  let thumbReady=0;
  const thumbKey='private/thumbnails/'+id+'.jpg';
  if(await env.MEDIA.head(thumbKey))thumbReady=1;
  else if(items[i][kind+'_item']?.thumb_media){
   try{
    const thumb={type:2,image_item:{media:items[i][kind+'_item'].thumb_media}};
    const preview=await downloadWeChatImage(thumb,{...options,maxBytes:524288});
    if(preview.mime==='image/jpeg'&&preview.bytes.length<=524288){
     await env.MEDIA.put(thumbKey,preview.bytes,{httpMetadata:{contentType:'image/jpeg'}});
     thumbReady=1;
    }
   }catch{/* Thumbnail is always optional. */}
  }
  const indexStartedAt=performance.now();
  await env.DB.prepare('INSERT OR IGNORE INTO media(id,baby_id,day,title,description,object_key,mime,size,created_at,thumbnail_ready,source_message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,baby.id,day,title,caption,objectKey,mime,size,new Date().toISOString(),thumbReady,sourceId).run();
  const indexed=await env.DB.prepare('SELECT id FROM media WHERE source_message_id=?').bind(sourceId).first();
  if(!indexed)throw Error('WECHAT_MEDIA_INDEX_FAILED');
  mediaTiming({channel:'wechat',stage:'index',size,startedAt:indexStartedAt});
  mediaTiming({channel:'wechat',stage:'total',size,startedAt:itemStartedAt});
  return {id:indexed.id,kind,already:false};
 }
 // At most two parallel decrypt+R2 streams; preserve source order and await all
 // in-flight uploads before surfacing a failure to the idempotent retry path.
 for(let i=0;i<items.length;i+=2){
  const outcome=await Promise.allSettled(items.slice(i,i+2).map((_,j)=>persistItem(i+j)));
  let failure=null;
  for(const o of outcome){if(o.status==='fulfilled')result.push(o.value);else failure??=o.reason}
  if(failure)throw failure;
 }
 const fresh=result.filter(x=>!x.already),dupes=result.length-fresh.length;
 if(!fresh.length)return '这些照片或视频已经保存过，无需重复导入。';
 const images=fresh.filter(x=>x.kind==='image').length,videos=fresh.filter(x=>x.kind==='video').length;
 return '已保存 '+baby.name+' 的'+(images?' '+images+' 张照片':'')+(videos?' '+videos+' 段视频':'')+'到私密家庭相册。'+(dupes?'（'+dupes+' 项重复消息已跳过）':'')+'\n可在网页家庭相册查看原件。';
}
export const persistWeChatPhotos=persistWeChatMedia;
