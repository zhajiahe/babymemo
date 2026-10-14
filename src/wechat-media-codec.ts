import {createHash} from 'node:crypto';
export type WechatMediaItem=Record<string,any>&{type?:number;image_item?:Record<string,any>;video_item?:Record<string,any>};
export const MAX_WECHAT_MEDIA_BYTES=50*1024*1024;
export const MAX_WECHAT_IMAGE_BYTES=MAX_WECHAT_MEDIA_BYTES; // backwards compatibility
export const MAX_ITEMS=4,PART=8*1024*1024,CDN='novac2c.cdn.weixin.qq.com';
export class WechatPhotoError extends Error{constructor(message:string){super(message);this.name='WechatPhotoError'}}
export const bad:(msg:string)=>never=(msg)=>{throw new WechatPhotoError(msg)};
// Persist only fixed codes; provider errors may include private CDN URLs or keys.
export function wechatMediaErrorCode(error:unknown){
 const message=error instanceof Error?error.message:'';
 if(/^WECHAT_(?:CDN_NETWORK_ERROR|CDN_HTTP_[1-5][0-9]{2}|MEDIA_MIME_MISMATCH|MEDIA_INDEX_FAILED)$/.test(message))return message;
 if(error instanceof WechatPhotoError)return 'WECHAT_MEDIA_INVALID_PAYLOAD';
 if(/^D1_/.test(message))return 'WECHAT_MEDIA_D1_FAILED';
 if(/^R2\b/.test(message))return 'WECHAT_MEDIA_R2_FAILED';
 if(error instanceof ReferenceError)return 'WECHAT_MEDIA_RUNTIME_ERROR';
 if(error instanceof TypeError)return 'WECHAT_MEDIA_TYPE_ERROR';
 return 'WECHAT_MEDIA_PROCESSING_ERROR';
}
export function decodeWeChatAesKey(encoded:unknown):Buffer{
 if(typeof encoded!=='string'||encoded.length>200||!encoded.trim())throw new WechatPhotoError('微信媒体密钥缺失，请重新发送');
 const v=encoded.trim();
 if(/^[a-f0-9]{32}$/i.test(v))return Buffer.from(v,'hex');
 if(!/^[a-zA-Z0-9+/]+={0,2}$/.test(v))throw new WechatPhotoError('微信媒体密钥格式无效');
 const raw=Buffer.from(v,'base64');
 if(raw.length===16)return raw;
 if(raw.length===32&&/^[a-f0-9]{32}$/i.test(raw.toString('ascii')))return Buffer.from(raw.toString('ascii'),'hex');
 throw new WechatPhotoError('微信媒体密钥格式无效');
}
export function imageReference(item:WechatMediaItem){
 const source=item?.image_item;
 if(!source||(item.type!==2&&item.type!==undefined))throw new WechatPhotoError('微信照片引用无效');
 const media=source.media||source;
 // Tencent iLink's image_item.aeskey overrides CDN media.aes_key.
 return {media,key:source.aeskey||source.aes_key||media.aes_key||media.aeskey};
}
export function mediaReference(item:WechatMediaItem){
 if(item?.type===5&&item?.video_item?.media){
  const m=item.video_item.media;
  return {media:m,key:m.aes_key||m.aeskey,kind:'video' as const};
 }
 return {...imageReference(item),kind:'image' as const};
}
export function wechatCdnUrl(media:Record<string,unknown>){
 if(!media||typeof media!=='object')bad('微信 CDN 媒体链接无效');
 let url:URL|undefined;
 const candidate=media.full_url||media.download_url||media.url;
 if(candidate!==undefined){
  if(typeof candidate!=='string')throw new WechatPhotoError('微信 CDN 媒体链接无效');
  try{url=new URL(candidate)}catch{throw new WechatPhotoError('微信 CDN 媒体链接无效')}
 }else{
  const param=media.encrypt_query_param;
  if(typeof param!=='string'||!param||param.length>8192)throw new WechatPhotoError('微信 CDN 下载参数无效');
  // Tencent's @tencent-weixin/openclaw-weixin 2.4.10 uses CDN_BASE_URL /c2c.
  url=new URL('https://'+CDN+'/c2c/download');
  url.searchParams.set('encrypted_query_param',param);
 }
 if(!url||url.protocol!=='https:'||url.hostname!==CDN||url.port||url.username||url.password||
    !['/download','/c2c/download'].includes(url.pathname)||url.hash||url.search.length>10000)
  bad('拒绝非白名单微信 CDN 媒体链接');
 return url.toString();
}
function sniff(buffer:Uint8Array,kind:'image'|'video'):string|null{
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
export function inspectImage(bytes:Uint8Array):string{const mime=sniff(bytes,'image');if(!mime)throw new WechatPhotoError('微信文件不是可识别的照片');return mime}
export function inspectVideo(bytes:Uint8Array):string{const mime=sniff(bytes,'video');if(!mime)throw new WechatPhotoError('微信文件不是可识别的 MP4、MOV 或 WebM 视频');return mime}
export function mediaItems(raw:any):WechatMediaItem[]{
 if(!Array.isArray(raw?.item_list))return [];
 return raw.item_list.filter((i:WechatMediaItem)=>(i?.type===2&&i?.image_item)||(i?.type===5&&i?.video_item?.media));
}
export function photoItems(raw:any){return mediaItems(raw).filter(i=>i.type===2)}
export function videoItems(raw:any){return mediaItems(raw).filter(i=>i.type===5)}
export function photoRecordId(sourceId:string){
 const h=createHash('sha256').update('babymemo-wechat-photo-v1:'+sourceId).digest('hex').slice(0,32);
 return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
