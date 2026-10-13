// iLink encrypted image/video ingestion: private R2, D1 idempotency, no media URLs in DB.
// Stream plaintext into 8 MiB R2 multipart pieces: a 50 MiB video never occupies
// two 50 MiB buffers in a Cloudflare Worker. AES-ECB is iLink wire compatibility.
import {createDecipheriv,createHash} from 'node:crypto';
import {mediaTiming} from './media-timing.mjs';
export const MAX_WECHAT_MEDIA_BYTES=50*1024*1024;
export const MAX_WECHAT_IMAGE_BYTES=MAX_WECHAT_MEDIA_BYTES; // backwards compatibility
const MAX_ITEMS=4,PART=8*1024*1024,CDN='novac2c.cdn.weixin.qq.com';
export class WechatPhotoError extends Error{constructor(message){super(message);this.name='WechatPhotoError'}}
const bad=(msg)=>{throw new WechatPhotoError(msg)};
// Persist only fixed codes; provider errors may include private CDN URLs or keys.
export function wechatMediaErrorCode(error){
 const message=error instanceof Error?error.message:'';
 if(/^WECHAT_(?:CDN_NETWORK_ERROR|CDN_HTTP_[1-5][0-9]{2}|MEDIA_MIME_MISMATCH|MEDIA_INDEX_FAILED)$/.test(message))return message;
 if(error instanceof WechatPhotoError)return 'WECHAT_MEDIA_INVALID_PAYLOAD';
 if(/^D1_/.test(message))return 'WECHAT_MEDIA_D1_FAILED';
 if(/^R2\b/.test(message))return 'WECHAT_MEDIA_R2_FAILED';
 if(error instanceof ReferenceError)return 'WECHAT_MEDIA_RUNTIME_ERROR';
 if(error instanceof TypeError)return 'WECHAT_MEDIA_TYPE_ERROR';
 return 'WECHAT_MEDIA_PROCESSING_ERROR';
}
export function decodeWeChatAesKey(encoded){
 if(typeof encoded!=='string'||encoded.length>200||!encoded.trim())bad('微信媒体密钥缺失，请重新发送');
 const v=encoded.trim();
 if(/^[a-f0-9]{32}$/i.test(v))return Buffer.from(v,'hex');
 if(!/^[a-zA-Z0-9+/]+={0,2}$/.test(v))bad('微信媒体密钥格式无效');
 const raw=Buffer.from(v,'base64');
 if(raw.length===16)return raw;
 if(raw.length===32&&/^[a-f0-9]{32}$/i.test(raw.toString('ascii')))return Buffer.from(raw.toString('ascii'),'hex');
 bad('微信媒体密钥格式无效');
}
export function imageReference(item){
 const source=item?.image_item;
 if(!source||(item.type!==2&&item.type!==undefined))bad('微信照片引用无效');
 const media=source.media||source;
 // Tencent iLink's image_item.aeskey overrides CDN media.aes_key.
 return {media,key:source.aeskey||source.aes_key||media.aes_key||media.aeskey};
}
export function mediaReference(item){
 if(item?.type===5&&item?.video_item?.media){
  const m=item.video_item.media;
  return {media:m,key:m.aes_key||m.aeskey,kind:'video'};
 }
 return {...imageReference(item),kind:'image'};
}
export function wechatCdnUrl(media){
 if(!media||typeof media!=='object')bad('微信 CDN 媒体链接无效');
 let url;
 const candidate=media.full_url||media.download_url||media.url;
 if(candidate!==undefined){
  if(typeof candidate!=='string')bad('微信 CDN 媒体链接无效');
  try{url=new URL(candidate)}catch{bad('微信 CDN 媒体链接无效')}
 }else{
  const param=media.encrypt_query_param;
  if(typeof param!=='string'||!param||param.length>8192)bad('微信 CDN 下载参数无效');
  // Tencent's @tencent-weixin/openclaw-weixin 2.4.10 uses CDN_BASE_URL /c2c.
  url=new URL('https://'+CDN+'/c2c/download');
  url.searchParams.set('encrypted_query_param',param);
 }
 if(url.protocol!=='https:'||url.hostname!==CDN||url.port||url.username||url.password||
    !['/download','/c2c/download'].includes(url.pathname)||url.hash||url.search.length>10000)
  bad('拒绝非白名单微信 CDN 媒体链接');
 return url.toString();
}
function sniff(buffer,kind){
 if(kind==='video'){
  if(buffer.length>=12&&Buffer.from(buffer.subarray(4,8)).toString()==='ftyp'){
    const brand=Buffer.from(buffer.subarray(8,12)).toString();
    if(brand==='qt  ')return 'video/quicktime';
    if(/^(isom|iso2|mp4.|avc1|M4V |MSNV|3gp.|3g2.|heic|hevc)$/i.test(brand))return 'video/mp4';
  }
  if(buffer.length>=4&&buffer[0]===0x1a&&buffer[1]===0x45&&buffer[2]===0xdf&&buffer[3]===0xa3)return 'video/webm';
  return null;
 }
 if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
 if(buffer.length>=8&&Buffer.from(buffer.subarray(0,8)).toString('hex')==='89504e470d0a1a0a')return 'image/png';
 if(buffer.length>=6&&['GIF87a','GIF89a'].includes(Buffer.from(buffer.subarray(0,6)).toString()))return 'image/gif';
 if(buffer.length>=12&&Buffer.from(buffer.subarray(0,4)).toString()==='RIFF'&&Buffer.from(buffer.subarray(8,12)).toString()==='WEBP')return 'image/webp';
 if(buffer.length>=12&&Buffer.from(buffer.subarray(4,8)).toString()==='ftyp'&&/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(Buffer.from(buffer.subarray(8,12)).toString()))return 'image/heic';
 return null;
}
export function inspectImage(bytes){const mime=sniff(bytes,'image');if(!mime)bad('微信文件不是可识别的照片');return mime}
export function inspectVideo(bytes){const mime=sniff(bytes,'video');if(!mime)bad('微信文件不是可识别的 MP4、MOV 或 WebM 视频');return mime}
export function mediaItems(raw){
 if(!Array.isArray(raw?.item_list))return [];
 return raw.item_list.filter(i=>(i?.type===2&&i?.image_item)||(i?.type===5&&i?.video_item?.media));
}
export function photoItems(raw){return mediaItems(raw).filter(i=>i.type===2)}
export function videoItems(raw){return mediaItems(raw).filter(i=>i.type===5)}
export function photoRecordId(sourceId){
 const h=createHash('sha256').update('babymemo-wechat-photo-v1:'+sourceId).digest('hex').slice(0,32);
 return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
async function cdnFetch(item,{fetchImpl=fetch,maxBytes=MAX_WECHAT_MEDIA_BYTES}={}){
 const startedAt=performance.now();
 const {media,key,kind}=mediaReference(item);
 const aesKey=decodeWeChatAesKey(key),url=wechatCdnUrl(media);
 const expected=kind==='video'?item.video_item.video_size:item.image_item?.mid_size;
 if(expected!==undefined&&Number(expected)>maxBytes+16)bad('微信图片或视频超过 50 MB 限制');
 let response;
 try{response=await fetchImpl(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(60000)})}
 catch{throw Error('WECHAT_CDN_NETWORK_ERROR')}
 if(response.status>=300&&response.status<400)bad('微信 CDN 不允许重定向');
 if(!response.ok){
  if([400,401,403,404,410].includes(response.status))bad('微信媒体链接已过期，请重新发送');
  throw Error('WECHAT_CDN_HTTP_'+response.status);
 }
 const length=response.headers.get('Content-Length');
 if(length!==null&&Number(length)>maxBytes+16)bad('微信图片或视频超过 50 MB 限制');
 if(!response.body)bad('微信媒体响应为空');
 mediaTiming({channel:'wechat',stage:'cdn',size:Number(length||0),startedAt});
 return {reader:response.body.getReader(),aesKey,kind};
}
async function decryptAndSink(item,write,{fetchImpl=fetch,maxBytes=MAX_WECHAT_MEDIA_BYTES}={}){
 const {reader,aesKey,kind}=await cdnFetch(item,{fetchImpl,maxBytes});
 // ECB has no IV. Workers' node:crypto requires an explicit empty buffer;
 // null is accepted by Node.js but rejected by the Workers runtime.
 const cipher=createDecipheriv('aes-128-ecb',aesKey,Buffer.alloc(0));
 let encrypted=0,plain=0,mime=null,first=Buffer.alloc(0);
 async function consume(chunk){
  if(!chunk.length)return;
  plain+=chunk.length;
  if(plain>maxBytes)bad('微信图片或视频超过 50 MB 限制');
  if(first.length<32)first=Buffer.concat([first,chunk.subarray(0,32-first.length)]);
  if(!mime&&first.length>=12)mime=kind==='video'?inspectVideo(first):inspectImage(first);
  await write(chunk,mime);
 }
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   encrypted+=value.byteLength;
   if(encrypted>maxBytes+16)bad('微信图片或视频超过 50 MB 限制');
   if(!value.byteLength)continue;
   await consume(cipher.update(value));
  }
  if(!encrypted||encrypted%16!==0)bad('微信媒体加密内容长度无效');
  try{await consume(cipher.final())}
  catch(e){if(e instanceof WechatPhotoError)throw e;bad('微信媒体 AES 解密失败')}
  if(!mime)bad('不支持的微信图片或视频格式');
  return {size:plain,mime};
 }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
// For thumbnail parsing and isolated tests only. Originals use bounded multipart sink.
export async function downloadWeChatImage(item,options={}){
 const chunks=[];
 const result=await decryptAndSink(item,async bytes=>{chunks.push(Buffer.from(bytes))},options);
 if(result.mime.startsWith('video/'))bad('缩略图不能是视频');
 return {bytes:new Uint8Array(Buffer.concat(chunks)),mime:result.mime};
}
export async function downloadWeChatVideo(item,options={}){
 const chunks=[];
 const result=await decryptAndSink(item,async bytes=>{chunks.push(Buffer.from(bytes))},options);
 if(!result.mime.startsWith('video/'))bad('不是有效视频');
 return {bytes:new Uint8Array(Buffer.concat(chunks)),mime:result.mime};
}
// At most two R2 parts in flight for a single 50 MiB WeChat video.
// The CDN download continues while R2 uploads complete, with explicit
// backpressure at 2 parts (plus one pending 8 MiB buffer). Parts are ordered
// by part number before completion, irrespective of network completion order.
export async function storeEncryptedMedia(bucket,objectKey,item,options={}){
 let pending=[],pendingSize=0,multipart=null,partNo=0,parts=[],detectedMime=null;
 const active=[],metadata=mime=>({httpMetadata:{contentType:mime}});
 const drainOne=async()=>{
  const {index,result}=await Promise.race(active.map((p,index)=>p.then(result=>({index,result}))));
  active.splice(index,1);
  if(!result.ok)throw result.error;
  parts.push({partNumber:result.number,etag:result.etag});
 };
 async function uploadBlocks(){
  if(!multipart)multipart=await bucket.createMultipartUpload(objectKey,metadata(detectedMime||'application/octet-stream'));
  while(pendingSize>=PART){
   const combined=Buffer.concat(pending);
   const block=combined.subarray(0,PART);
   pending=combined.length>PART?[combined.subarray(PART)]:[];
   pendingSize=combined.length-PART;
   const number=++partNo,startedAt=performance.now();
   // Convert rejected promises into values, so draining/abort never creates
   // unhandled rejections if a second in-flight part fails first.
   const task=multipart.uploadPart(number,block).then(
    part=>{mediaTiming({channel:'wechat',stage:'r2',size:block.length,startedAt});return {ok:true,number,etag:part.etag}},
    error=>{mediaTiming({channel:'wechat',stage:'r2',size:block.length,startedAt,status:'error'});return {ok:false,number,error}}
   );
   active.push(task);
   if(active.length>=2)await drainOne();
  }
 }
 try{
  const result=await decryptAndSink(item,async(chunk,mime)=>{
   if(mime)detectedMime=mime;
   pending.push(Buffer.from(chunk));pendingSize+=chunk.length;
   if(pendingSize>=PART)await uploadBlocks();
  },options);
  if(!multipart){
   const startedAt=performance.now();
   await bucket.put(objectKey,Buffer.concat(pending),metadata(result.mime));
   mediaTiming({channel:'wechat',stage:'r2',size:result.size,startedAt});
  }else{
   if(pendingSize){
    const number=++partNo,block=Buffer.concat(pending),startedAt=performance.now();
    active.push(multipart.uploadPart(number,block).then(
     part=>{mediaTiming({channel:'wechat',stage:'r2',size:block.length,startedAt});return {ok:true,number,etag:part.etag}},
     error=>{mediaTiming({channel:'wechat',stage:'r2',size:block.length,startedAt,status:'error'});return {ok:false,number,error}}
    ));
   }
   while(active.length)await drainOne();
   parts.sort((a,b)=>a.partNumber-b.partNumber);
   const finishAt=performance.now();
   await multipart.complete(parts);
   mediaTiming({channel:'wechat',stage:'finish',size:result.size,startedAt:finishAt});
  }
  return result;
 }catch(error){
  // Wait for any outstanding uploadPart calls before aborting the multipart
  // session; otherwise parts could land after abort and leak R2 storage.
  await Promise.all(active);
  if(multipart)try{await multipart.abort()}catch{}
  throw error;
 }
}
function localDay(raw,baby){
 const ts=Number(raw.create_time_ms);
 const date=Number.isFinite(ts)&&ts>1500000000000&&ts<Date.now()+86400000?new Date(ts):new Date();
 try{return date.toLocaleDateString('sv-SE',{timeZone:baby.time_zone||'Asia/Shanghai'})}
 catch{return date.toISOString().slice(0,10)}
}
export async function persistWeChatMedia(env,raw,baby,messageId,options={}){
 const items=mediaItems(raw);
 if(!items.length)return null;
 if(items.length>MAX_ITEMS)bad('单条消息最多保存 4 项媒体，请分批发送');
 const result=[];
 async function persistItem(i){
  const itemStartedAt=performance.now();
  const kind=items[i].type===5?'video':'image';
  const sourceId=messageId+':'+kind+':'+i,id=photoRecordId(sourceId);
  const existing=await env.DB.prepare('SELECT id,deleted_at FROM media WHERE source_message_id=?').bind(sourceId).first();
  if(existing)return {id:existing.id,kind,already:true};
  const objectKey='private/'+baby.id+'/'+id;
  const old=await env.MEDIA.head(objectKey);
  let size=old?.size||0,mime=old?.httpMetadata?.contentType;
  if(!old){
   const saved=await storeEncryptedMedia(env.MEDIA,objectKey,items[i],options);
   size=saved.size;mime=saved.mime;
  }
  if(typeof mime!=='string'||!mime.startsWith(kind+'/'))throw Error('WECHAT_MEDIA_MIME_MISMATCH');
  const day=localDay(raw,baby);
  const caption=raw.item_list?.filter(x=>x?.type===1&&typeof x.text_item?.text==='string')
    .map(x=>x.text_item.text).join(' ').trim().slice(0,100);
  const title=caption||(kind==='video'?'微信视频 ':'微信照片 ')+day;
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
  await env.DB.prepare('INSERT OR IGNORE INTO media(id,baby_id,day,title,object_key,mime,size,created_at,thumbnail_ready,source_message_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(id,baby.id,day,title,objectKey,mime,size,new Date().toISOString(),thumbReady,sourceId).run();
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
