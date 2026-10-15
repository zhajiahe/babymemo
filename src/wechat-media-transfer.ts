import {createDecipheriv} from 'node:crypto';
import {mediaTiming} from './media-timing.mjs';
import {bad,WechatPhotoError,decodeWeChatAesKey,wechatCdnUrl,mediaReference,fileAttachmentInfo,inspectImage,inspectVideo,MAX_WECHAT_MEDIA_BYTES,PART,type WechatMediaItem} from './wechat-media-codec.ts';
export type MediaTransferOptions={fetchImpl?:typeof fetch;maxBytes?:number};
async function cdnFetch(item:WechatMediaItem,{fetchImpl=fetch,maxBytes=MAX_WECHAT_MEDIA_BYTES}:MediaTransferOptions={}){
 const startedAt=performance.now();
 const {media,key,kind}=mediaReference(item);
 const aesKey=decodeWeChatAesKey(key),url=wechatCdnUrl(media);
 const expected=item.type===4?item.file_item?.len:kind==='video'?item.video_item?.video_size:item.image_item?.mid_size;
 if(item.type===4&&expected!==undefined&&(!/^(?:0|[1-9]\\d*)$/.test(String(expected))||!Number.isSafeInteger(Number(expected))||Number(expected)<1))
  bad('微信文件大小无效');
 if(expected!==undefined&&Number(expected)>maxBytes+(item.type===4?0:16))bad('微信图片或视频超过 50 MB 限制');
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
 if(!response.body)throw new WechatPhotoError('微信媒体响应为空');
 mediaTiming({channel:'wechat',stage:'cdn',size:Number(length||0),startedAt});
 return {reader:response.body.getReader(),aesKey,kind};
}
async function decryptAndSink(item:WechatMediaItem,write:(chunk:Buffer,mime:string|null)=>Promise<void>,{fetchImpl=fetch,maxBytes=MAX_WECHAT_MEDIA_BYTES}:MediaTransferOptions={}){
 const {reader,aesKey,kind}=await cdnFetch(item,{fetchImpl,maxBytes});
 // ECB has no IV. Workers' node:crypto requires an explicit empty buffer;
 // null is accepted by Node.js but rejected by the Workers runtime.
 const cipher=createDecipheriv('aes-128-ecb',aesKey,Buffer.alloc(0));
 let encrypted=0,plain=0,mime:string|null=null,first=Buffer.alloc(0);
 async function consume(chunk:Buffer){
  if(!chunk.length)return;
  plain+=chunk.length;
  if(plain>maxBytes)bad('微信图片或视频超过 50 MB 限制');
  if(first.length<32)first=Buffer.concat([first,chunk.subarray(0,32-first.length)]);
  if(!mime&&first.length>=12){
   mime=kind==='video'?inspectVideo(first):inspectImage(first);
   const declared=item.type===4?fileAttachmentInfo(item)?.mime:null;
   if(declared&&mime!==declared)bad('微信附件扩展名与实际格式不一致，请发送原始照片或视频文件');
  }
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
  if(!mime)throw new WechatPhotoError('不支持的微信图片或视频格式');
  return {size:plain,mime:mime as string};
 }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
}
// For thumbnail parsing and isolated tests only. Originals use bounded multipart sink.
export async function downloadWeChatImage(item:WechatMediaItem,options:MediaTransferOptions={}){
 const chunks:Buffer[]=[];
 const result=await decryptAndSink(item,async bytes=>{chunks.push(Buffer.from(bytes))},options);
 if(result.mime.startsWith('video/'))bad('缩略图不能是视频');
 return {bytes:new Uint8Array(Buffer.concat(chunks)),mime:result.mime};
}
export async function downloadWeChatVideo(item:WechatMediaItem,options:MediaTransferOptions={}){
 const chunks:Buffer[]=[];
 const result=await decryptAndSink(item,async bytes=>{chunks.push(Buffer.from(bytes))},options);
 if(!result.mime.startsWith('video/'))bad('不是有效视频');
 return {bytes:new Uint8Array(Buffer.concat(chunks)),mime:result.mime};
}
// At most two R2 parts in flight for a single 50 MiB WeChat video.
// The CDN download continues while R2 uploads complete, with explicit
// backpressure at 2 parts (plus one pending 8 MiB buffer). Parts are ordered
// by part number before completion, irrespective of network completion order.
export async function storeEncryptedMedia(bucket:R2Bucket,objectKey:string,item:WechatMediaItem,options:MediaTransferOptions={}){
 let pending:Buffer[]=[],pendingSize=0,multipart:R2MultipartUpload|null=null,partNo=0,parts:R2UploadedPart[]=[],detectedMime:string|null=null;
 type PartResult={ok:boolean;number:number;etag?:string;error?:unknown};
 const active:Promise<PartResult>[]=[],metadata=(mime:string)=>({httpMetadata:{contentType:mime}});
 const drainOne=async()=>{
  const {index,result}=await Promise.race(active.map((p,index)=>p.then(result=>({index,result}))));
  active.splice(index,1);
  if(!result.ok)throw result.error;
  parts.push({partNumber:result.number,etag:result.etag!});
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
   const task=(multipart as R2MultipartUpload).uploadPart(number,block).then(
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
   await bucket.put(objectKey,Buffer.concat(pending),metadata(result.mime||'application/octet-stream'));
   mediaTiming({channel:'wechat',stage:'r2',size:result.size,startedAt});
  }else{
   if(pendingSize){
    const number=++partNo,block=Buffer.concat(pending),startedAt=performance.now();
    active.push((multipart as R2MultipartUpload).uploadPart(number,block).then(
     part=>{mediaTiming({channel:'wechat',stage:'r2',size:block.length,startedAt});return {ok:true,number,etag:part.etag}},
     error=>{mediaTiming({channel:'wechat',stage:'r2',size:block.length,startedAt,status:'error'});return {ok:false,number,error}}
    ));
   }
   while(active.length)await drainOne();
   parts.sort((a,b)=>a.partNumber-b.partNumber);
   const finishAt=performance.now();
   await (multipart as R2MultipartUpload).complete(parts);
   mediaTiming({channel:'wechat',stage:'finish',size:result.size,startedAt:finishAt});
  }
  return result;
 }catch(error){
  // Wait for any outstanding uploadPart calls before aborting the multipart
  // session; otherwise parts could land after abort and leak R2 storage.
  await Promise.all(active);
  if(multipart)try{await (multipart as R2MultipartUpload).abort()}catch{}
  throw error;
 }
}
