// Private WeChat iLink image ingestion. AES-128-ECB is used ONLY for protocol
// compatibility, not for at-rest encryption (R2 remains private).
// Workers compatibility_date >= 2026-08-04 supports node:crypto.
import {createDecipheriv,createHash} from 'node:crypto';

export const MAX_WECHAT_IMAGE_BYTES=20*1024*1024;
const MAX_IMAGES_PER_MESSAGE=4;
const CDN_HOST='novac2c.cdn.weixin.qq.com';
export class WechatPhotoError extends Error{
 constructor(message){super(message);this.name='WechatPhotoError'}
}
const bad=msg=>{throw new WechatPhotoError(msg)};
const bytesToHex=buffer=>Buffer.from(buffer).toString('hex');

export function decodeWeChatAesKey(encoded){
 if(typeof encoded!=='string'||encoded.length>200||!encoded.trim())bad('图片密钥缺失，请重新发送照片');
 const value=encoded.trim();
 if(/^[0-9a-f]{32}$/i.test(value))return Buffer.from(value,'hex');
 if(!/^[a-zA-Z0-9+/]+={0,2}$/.test(value))bad('图片密钥格式不受支持');
 const raw=Buffer.from(value,'base64');
 if(raw.length===16)return raw;
 if(raw.length===32&&/^[0-9a-f]{32}$/i.test(raw.toString('ascii')))return Buffer.from(raw.toString('ascii'),'hex');
 bad('图片密钥格式不受支持');
}
export function imageReference(item){
 const image=item?.image_item;
 if(!image||(item.type!==2&&item.type!==undefined))bad('微信消息中没有有效照片');
 const media=image.media||image;
 if(!media||typeof media!=='object')bad('无法读取微信照片原图');
 const key=media.aes_key||media.aeskey||image.aes_key||image.aeskey;
 return {media,key};
}
export function wechatCdnUrl(media){
 if(!media||typeof media!=='object')bad('缺少微信照片下载地址');
 let candidate;
 if(typeof media.full_url==='string'&&media.full_url)candidate=media.full_url;
 else if(typeof media.download_url==='string'&&media.download_url)candidate=media.download_url;
 else if(typeof media.url==='string'&&media.url)candidate=media.url;
 else {
   const param=media.encrypt_query_param;
   if(typeof param!=='string'||!param||param.length>8192)bad('微信照片下载参数无效');
   candidate='https://'+CDN_HOST+'/c2c/download?encrypted_query_param='+encodeURIComponent(param);
 }
 let url;
 try{url=new URL(candidate)}catch{bad('微信照片 CDN 地址无效')}
 // Never fetch user/model controlled hosts, cloud metadata, or redirect URLs.
 if(url.protocol!=='https:'||url.hostname!==CDN_HOST||url.port||url.username||url.password||
    !url.pathname.startsWith('/c2c/download')||url.search.length>10000||url.hash)
   bad('拒绝非微信官方 CDN 图片地址');
 return url.toString();
}
function mimeFromMagic(buffer){
 if(buffer.length>=4&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
 if(buffer.length>=8&&bytesToHex(buffer.subarray(0,8))==='89504e470d0a1a0a')return 'image/png';
 if(buffer.length>=6&&['GIF87a','GIF89a'].includes(Buffer.from(buffer.subarray(0,6)).toString()))return 'image/gif';
 if(buffer.length>=12&&Buffer.from(buffer.subarray(0,4)).toString()==='RIFF'&&Buffer.from(buffer.subarray(8,12)).toString()==='WEBP')return 'image/webp';
 if(buffer.length>=12&&Buffer.from(buffer.subarray(4,8)).toString()==='ftyp'&&/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(Buffer.from(buffer.subarray(8,12)).toString()))return 'image/heic';
 return null;
}
export function inspectImage(buffer){
 const mime=mimeFromMagic(buffer);
 if(!mime)bad('微信文件不是可识别的照片格式');
 return mime;
}
async function limitedBody(response,max){
 const declared=response.headers.get('Content-Length');
 if(declared!==null){
  const length=Number(declared);
  if(!Number.isFinite(length)||length>max)bad('微信照片超过大小限制（单张最大 20MB）');
 }
 if(!response.body)bad('微信照片下载内容为空');
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>max){await reader.cancel();bad('微信照片超过大小限制（单张最大 20MB）')}
   chunks.push(value);
  }
 }finally{reader.releaseLock()}
 const merged=Buffer.allocUnsafe(size);let offset=0;
 for(const part of chunks){merged.set(part,offset);offset+=part.length}
 return merged;
}
export async function downloadWeChatImage(item,{fetchImpl=fetch,maxBytes=MAX_WECHAT_IMAGE_BYTES}={}){
 const {media,key}=imageReference(item);
 const download=wechatCdnUrl(media);
 const bytesKey=decodeWeChatAesKey(key);
 let response;
 try{
  response=await fetchImpl(download,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(25000)});
 }catch{throw Error('WECHAT_CDN_NETWORK_ERROR')}
 if(!response.ok){
  if([400,401,403,404,410].includes(response.status))bad('微信照片链接已失效，请重新发送');
  throw Error('WECHAT_CDN_HTTP_'+response.status);
 }
 // Never follow redirects: host verification must cover the final destination.
 if(response.status>=300&&response.status<400)bad('微信照片 CDN 发生重定向');
 const cipher=await limitedBody(response,maxBytes+16);
 if(!cipher.length||cipher.length%16!==0)bad('微信照片的加密内容无效');
 let data;
 try{
  const dec=createDecipheriv('aes-128-ecb',bytesKey,null);
  data=Buffer.concat([dec.update(cipher),dec.final()]);
 }catch{bad('微信照片解密失败，请重新发送')}
 if(!data.length||data.length>maxBytes)bad('微信照片超过大小限制（单张最大 20MB）');
 return {bytes:new Uint8Array(data),mime:inspectImage(data)};
}
export function photoItems(raw){
 if(!Array.isArray(raw?.item_list))return [];
 return raw.item_list.filter(item=>item?.image_item&&(item.type===2||item.type===undefined));
}
export function photoRecordId(sourceId){
 const hex=createHash('sha256').update('babymemo-wechat-photo-v1:'+sourceId).digest('hex').slice(0,32);
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
function localDay(raw,baby){
 const ts=Number(raw.create_time_ms);
 const date=Number.isFinite(ts)&&ts>1500000000000&&ts<Date.now()+86400000?new Date(ts):new Date();
 try{return date.toLocaleDateString('sv-SE',{timeZone:baby.time_zone||'Asia/Shanghai'})}
 catch{return date.toISOString().slice(0,10)}
}
function thumbRef(item){
 if(!item?.image_item?.thumb_media)return null;
 return {type:2,image_item:{media:item.image_item.thumb_media}};
}
export async function persistWeChatPhotos(env,raw,baby,messageId,options={}){
 const items=photoItems(raw);
 if(!items.length)return null;
 if(items.length>MAX_IMAGES_PER_MESSAGE)bad('单条微信消息最多导入 4 张照片，请分批发送');
 const results=[];
 for(let i=0;i<items.length;i++){
  const sourceId=messageId+':image:'+i;
  const id=photoRecordId(sourceId);
  const existing=await env.DB.prepare('SELECT id,deleted_at FROM media WHERE source_message_id=?').bind(sourceId).first();
  if(existing){results.push({id:existing.id,already:true});continue}
  const objectKey='private/'+baby.id+'/'+id;
  let size=0,mime='image/jpeg';
  const old=await env.MEDIA.head(objectKey);
  if(old){size=old.size;mime=old.httpMetadata?.contentType||mime}
  else {
   const downloaded=await downloadWeChatImage(items[i],options);
   size=downloaded.bytes.byteLength;mime=downloaded.mime;
   await env.MEDIA.put(objectKey,downloaded.bytes,{httpMetadata:{contentType:mime}});
  }
  const day=localDay(raw,baby);
  const caption=raw.item_list?.filter(x=>x?.type===1&&typeof x.text_item?.text==='string')
    .map(x=>x.text_item.text).join(' ').trim().slice(0,100);
  const title=caption||'微信照片 '+day;
  const date=new Date().toISOString();
  let thumbReady=0;
  const thumbKey='private/thumbnails/'+id+'.jpg';
  if(await env.MEDIA.head(thumbKey))thumbReady=1;
  else if(items[i].image_item?.thumb_media){
   try{
    const thumb=await downloadWeChatImage(thumbRef(items[i]),{...options,maxBytes:524288});
    if(thumb.mime==='image/jpeg'&&thumb.bytes.byteLength<=524288){
     await env.MEDIA.put(thumbKey,thumb.bytes,{httpMetadata:{contentType:'image/jpeg'}});
     thumbReady=1;
    }
   }catch{/* Thumbnail failure must not block original photo. */}
  }
  await env.DB.prepare('INSERT OR IGNORE INTO media(id,baby_id,day,title,object_key,mime,size,created_at,thumbnail_ready,source_message_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(id,baby.id,day,title,objectKey,mime,size,date,thumbReady,sourceId).run();
  const saved=await env.DB.prepare('SELECT id FROM media WHERE source_message_id=?').bind(sourceId).first();
  if(!saved)throw Error('WECHAT_MEDIA_INDEX_FAILED');
  results.push({id:saved.id,already:false});
 }
 const saved=results.filter(x=>!x.already).length,replayed=results.length-saved;
 const note=saved?'已保存 '+baby.name+' 的 '+saved+' 张照片到私密家庭相册。':'这些照片此前已处理，无须重复导入。';
 return note+(replayed?'（'+replayed+' 张重复消息已跳过）':'')+'\n可在 BabyMemo 网页的「家庭相册」查看原图。';
}
