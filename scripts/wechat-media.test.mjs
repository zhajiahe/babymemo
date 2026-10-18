import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {exifJpeg,exifHeic} from './fixtures/media-exif.mjs';
import {decodeWeChatAesKey,wechatCdnUrl,downloadWeChatImage,persistWeChatPhotos,mediaItems,fileAttachmentInfo,photoItems,videoItems,photoRecordId,WechatPhotoError,wechatMediaErrorCode,storeEncryptedMedia} from '../src/wechat-media.mjs';

const jpeg=Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]);
const key=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const cipher=()=>{
 const enc=createCipheriv('aes-128-ecb',key,null);
 return Buffer.concat([enc.update(jpeg),enc.final()]);
};
const item=(url='https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=abcdef')=>
 ({type:2,image_item:{media:{full_url:url,aes_key:key.toString('base64')}}});
const baby={id:'baby-test',name:'测试宝宝',time_zone:'Asia/Shanghai'};
const raw={create_time_ms:'1781200123000',item_list:[item()]};
function mockEnv({failIndexOnce=false}={}){
 const rows=new Map(),objects=new Map(),calls=[];
 let failing=failIndexOnce;
 return {
   rows,objects,calls,
   DB:{prepare(sql){
     const op={sql,params:[]};calls.push(op);
     return {
       bind(...args){op.params=args;return this},
       async first(){
         if(sql.includes('FROM media WHERE source_message_id'))return rows.get(op.params[0])||null;
         return null;
       },
       async run(){
         if(sql.includes('INSERT OR IGNORE INTO media')){
           if(failing){failing=false;throw Error('D1_TEMPORARY_FAILURE')}
           const [id,baby_id,day,title,description,object_key,mime,size,created_at,thumbnail_ready,source_message_id]=op.params;
           if(!rows.has(source_message_id))rows.set(source_message_id,{id,baby_id,day,title,description,object_key,mime,size,created_at,thumbnail_ready,source_message_id});
         }
         return {meta:{changes:1}};
       }
     };
   }},
   MEDIA:{
     async head(key){const x=objects.get(key);return x?{size:x.bytes.length,httpMetadata:{contentType:x.mime}}:null},
     async put(key,bytes,opts){objects.set(key,{bytes:new Uint8Array(bytes),mime:opts?.httpMetadata?.contentType});return {etag:'fake'}},
     async get(key,{range}={}){const x=objects.get(key);if(!x)return null;const bytes=x.bytes.slice(range?.offset||0,range?range.offset+range.length:undefined);return {arrayBuffer:async()=>bytes.buffer}}
   }
 };
}
const cdnFetch=async()=>new Response(cipher(),{status:200,headers:{'Content-Type':'application/octet-stream'}});
test('WeChat AES key encodings including raw hex, base64 bytes, base64 hex',()=>{
 assert.deepEqual(decodeWeChatAesKey(key.toString('hex')),key);
 assert.deepEqual(decodeWeChatAesKey(key.toString('base64')),key);
 assert.deepEqual(decodeWeChatAesKey(Buffer.from(key.toString('hex')).toString('base64')),key);
 assert.throws(()=>decodeWeChatAesKey('not a key'),WechatPhotoError);
});
test('CDN allowlist rejects arbitrary hosts, relative URLs, HTTP, and redirects',async()=>{
 const built=new URL(wechatCdnUrl({encrypt_query_param:'a/b+z=='}));
 assert.equal(built.origin,'https://novac2c.cdn.weixin.qq.com');
 assert.equal(built.pathname,'/c2c/download');
 assert.equal(built.searchParams.get('encrypted_query_param'),'a/b+z==');
 for(const url of ['http://novac2c.cdn.weixin.qq.com/c2c/download?x=y','https://evil.example/c2c/download',
   'https://novac2c.cdn.weixin.qq.com.evil.example/c2c/download','http://127.0.0.1/c2c/download']){
  assert.throws(()=>wechatCdnUrl({full_url:url}),WechatPhotoError);
 }
 await assert.rejects(()=>downloadWeChatImage(item(),{fetchImpl:async()=>Response.redirect('https://evil.example',302)}));
});
test('media diagnostics retain only fixed codes, never provider error contents',()=>{
 assert.equal(wechatMediaErrorCode(Error('WECHAT_CDN_HTTP_502')),'WECHAT_CDN_HTTP_502');
 assert.equal(wechatMediaErrorCode(Error('D1_ERROR: synthetic query failed')),'WECHAT_MEDIA_D1_FAILED');
 assert.equal(wechatMediaErrorCode(Error('R2 put failed')),'WECHAT_MEDIA_R2_FAILED');
 assert.equal(wechatMediaErrorCode(Error('https://private.example/?key=synthetic-private-key')),'WECHAT_MEDIA_PROCESSING_ERROR');
 assert.equal(wechatMediaErrorCode(new WechatPhotoError('synthetic private payload')),'WECHAT_MEDIA_INVALID_PAYLOAD');
});
test('encrypted image decrypts, MIME is sniffed, and only JPEG bytes are persisted',async()=>{
 const got=await downloadWeChatImage(item(),{fetchImpl:cdnFetch});
 assert.equal(got.mime,'image/jpeg');
 assert.deepEqual(got.bytes,jpeg);
 const env=mockEnv();
 const msg=await persistWeChatPhotos(env,raw,baby,'bot:message1',{fetchImpl:cdnFetch});
 assert.match(msg,/已保存.*1 张照片/);
 assert.equal(env.rows.size,1);assert.equal(env.objects.size,1);
 const record=[...env.rows.values()][0];
 assert.equal(record.mime,'image/jpeg');assert.equal(record.baby_id,baby.id);
 assert.equal(record.object_key,'private/'+baby.id+'/'+record.id);
 assert.equal(record.source_message_id,'bot:message1:image:0');
 assert.deepEqual(env.objects.get(record.object_key).bytes,jpeg);
 const again=await persistWeChatPhotos(env,raw,baby,'bot:message1',{fetchImpl:async()=>{throw Error('should not redownload')}});
 assert.match(again,/重复导入|此前已处理|无须重复/);
 assert.equal(env.rows.size,1);assert.equal(env.objects.size,1);
});


test('normal WeChat photo auto-archives by retained XMP capture date without file-attachment mode',async()=>{
 const body=new TextEncoder().encode('http://ns.adobe.com/xap/1.0/'+String.fromCharCode(0)+
  '<rdf:Description photoshop:DateCreated="2020-09-03" xmp:ModifyDate="2026-10-15"/>');
 const bytes=new Uint8Array(2+4+body.length+2);
 bytes.set([255,216,255,225]);new DataView(bytes.buffer).setUint16(4,body.length+2,false);
 bytes.set(body,6);bytes.set([255,217],6+body.length);
 const env=mockEnv();
 const reply=await persistWeChatPhotos(env,raw,baby,'bot:image-xmp-only',
  {fetchImpl:async()=>new Response(encrypted(bytes))});
 assert.match(reply,/已保存.*1 张照片/);
 const row=[...env.rows.values()][0];
 assert.equal(row.day,'2020-09-03');
 assert.equal(row.mime,'image/jpeg');
 assert.deepEqual(env.objects.get(row.object_key).bytes,bytes);
});
test('normal WeChat photo with all metadata removed cannot gain a fabricated capture date',async()=>{
 const env=mockEnv();
 const reply=await persistWeChatPhotos(env,raw,baby,'bot:image-no-metadata',{fetchImpl:cdnFetch});
 assert.equal([...env.rows.values()][0].day,new Date(Number(raw.create_time_ms)).toLocaleDateString('sv-SE',{timeZone:baby.time_zone}));
 assert.match(reply,/1 项未读取到原始拍摄日期，暂按微信发送日期归档/);
 assert.match(reply,/网页相册中修改/);
});
test('camera EXIF date does not trigger send-date fallback warning',async()=>{
 const bytes=exifJpeg(),env=mockEnv();
 const reply=await persistWeChatPhotos(env,raw,baby,'bot:camera-exif',{
  fetchImpl:async()=>new Response(encrypted(bytes))
 });
 assert.equal([...env.rows.values()][0].day,'2020-09-03');
 assert.doesNotMatch(reply,/未读取到原始拍摄日期/);
});
test('retained XMP camera date also does not trigger fallback warning',async()=>{
 const body=new TextEncoder().encode('http://ns.adobe.com/xap/1.0/'+String.fromCharCode(0)+'<rdf:Description xmp:CreateDate="2020-09-03"/>');
 const bytes=new Uint8Array(2+4+body.length+2);
 bytes.set([255,216,255,225]);new DataView(bytes.buffer).setUint16(4,body.length+2,false);
 bytes.set(body,6);bytes.set([255,217],6+body.length);
 const env=mockEnv();
 const reply=await persistWeChatPhotos(env,raw,baby,'bot:xmp-capture',{
  fetchImpl:async()=>new Response(encrypted(bytes))
 });
 assert.equal([...env.rows.values()][0].day,'2020-09-03');
 assert.doesNotMatch(reply,/未读取到原始拍摄日期/);
});

const fileItem=(name,len)=>({type:4,file_item:{file_name:name,len:String(len),media:{encrypt_query_param:'synthetic',aes_key:key.toString('base64')}}});
const encrypted=bytes=>{const cipher=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([cipher.update(bytes),cipher.final()])};
test('only named image/video file attachments are admitted; no arbitrary files or paths',()=>{
 const ok=fileItem('IMG_001.HEIC',100);
 const vid=fileItem('trip.MOV',200);
 const other=fileItem('secrets.pdf',300);
 const traversal=fileItem('../photo.jpg',200);
 const packed={item_list:[item(),ok,vid,other,traversal]};
 assert.equal(mediaItems(packed).length,3);
 assert.equal(photoItems(packed).length,2);
 assert.equal(videoItems(packed).length,1);
 assert.deepEqual(fileAttachmentInfo(ok),{kind:'image',mime:'image/heic',fileName:'IMG_001.HEIC'});
 assert.equal(fileAttachmentInfo(other),null);
 assert.equal(fileAttachmentInfo(traversal),null);
 assert.equal(mediaItems({item_list:[{type:4,file_item:{file_name:'IMG.jpg'}}]}).length,0);
});
test('iLink image file attachment keeps byte-identical EXIF original and camera date',async()=>{
 const bytes=exifJpeg(),file=fileItem('IMG_0007.JPG',bytes.length);
 const env=mockEnv();
 const message={...raw,item_list:[file]};
 const reply=await persistWeChatPhotos(env,message,baby,'bot:file-exif',{fetchImpl:async()=>new Response(encrypted(bytes))});
 assert.match(reply,/已保存.*1 张照片/);
 assert.match(reply,/文件附件按收到的原始字节保存/);
 const row=[...env.rows.values()][0];
 assert.equal(row.title,'IMG_0007.JPG');
 assert.equal(row.mime,'image/jpeg');
 assert.equal(row.day,'2020-09-03');
 assert.equal(row.source_message_id,'bot:file-exif:image:0');
 assert.deepEqual(env.objects.get(row.object_key).bytes,bytes);
 const dup=await persistWeChatPhotos(env,message,baby,'bot:file-exif',{fetchImpl:async()=>{throw Error('FILE_ALREADY_SAVED')}});
 assert.match(dup,/重复导入/);
 assert.equal(env.rows.size,1);
});
test('encrypted HEIC attachment is stored unchanged and original date survives R2 metadata reads',async()=>{
 const bytes=exifHeic(),env=mockEnv();
 const reply=await persistWeChatPhotos(env,{...raw,item_list:[fileItem('IMG_0008.heif',bytes.length)]},
  baby,'bot:file-heic',{fetchImpl:async()=>new Response(encrypted(bytes))});
 assert.match(reply,/已保存/);
 const row=[...env.rows.values()][0];
 assert.equal(row.mime,'image/heic');
 assert.equal(row.day,'2020-09-03');
 assert.deepEqual(env.objects.get(row.object_key).bytes,bytes);
});
test('file attachment MIME spoofing and malformed declared sizes fail before writing to R2',async()=>{
 const bytes=exifJpeg();
 const badFile=fileItem('photo.png',bytes.length),env=mockEnv();
 await assert.rejects(()=>persistWeChatPhotos(env,{...raw,item_list:[badFile]},baby,'bot:spoof',
  {fetchImpl:async()=>new Response(encrypted(bytes))}),/扩展名与实际格式不一致/);
 assert.equal(env.objects.size,0);
 const oversize=fileItem('photo.jpg',50*1024*1024+1);
 await assert.rejects(()=>persistWeChatPhotos(mockEnv(),{...raw,item_list:[oversize]},baby,'bot:oversize',
  {fetchImpl:async()=>{throw Error('SHOULD_NOT_DOWNLOAD')} }),/超过 50 MB/);
 const invalid=fileItem('photo.jpg','garbled');invalid.file_item.len='garbled';
 await assert.rejects(()=>persistWeChatPhotos(mockEnv(),{...raw,item_list:[invalid]},baby,'bot:invalidlen',
  {fetchImpl:async()=>{throw Error('SHOULD_NOT_DOWNLOAD')}}),/文件大小无效/);
});

test('queued WeChat job resumes a placeholder marked failed by stale reconciliation',async()=>{
 const env=mockEnv();
 const source='bot:resumed:image:0',id=photoRecordId(source),objectKey='private/'+baby.id+'/'+id;
 env.rows.set(source,{id,baby_id:baby.id,upload_state:'failed',deleted_at:null,purge_token:null});
 env.objects.set(objectKey,{bytes:jpeg,mime:'image/jpeg'});
 const response=await persistWeChatPhotos(env,raw,baby,'bot:resumed',{fetchImpl:async()=>{throw Error('MUST_REUSE_EXISTING_R2')}});
 assert.match(response,/已保存.*1 张照片/);
 assert.ok(env.calls.some(c=>c.sql.includes("UPDATE media SET upload_state='processing'")));
 assert.ok(env.calls.some(c=>c.sql.includes("upload_state='ready'")));
 assert.equal(env.objects.size,1,'must not rewrite or delete the original');
});
test('lost D1 commit is recovered from private R2 on retry without fetching CDN again',async()=>{
 const env=mockEnv({failIndexOnce:true});
 await assert.rejects(()=>persistWeChatPhotos(env,raw,baby,'bot:message2',{fetchImpl:cdnFetch}),/D1_TEMPORARY_FAILURE/);
 assert.equal(env.rows.size,0);assert.equal(env.objects.size,1);
 const msg=await persistWeChatPhotos(env,raw,baby,'bot:message2',{fetchImpl:async()=>{throw Error('CDN_MUST_NOT_REPEAT')}});
 assert.match(msg,/已保存/);assert.equal(env.rows.size,1);assert.equal(env.objects.size,1);
});
test('reject invalid decrypted payload and resource exhaustion',async()=>{
 const encryptedBad=(()=>{const e=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([e.update('HTML, not an image'),e.final()])})();
 await assert.rejects(()=>downloadWeChatImage(item(),{fetchImpl:async()=>new Response(encryptedBad)}),WechatPhotoError);
 await assert.rejects(()=>downloadWeChatImage(item(),{fetchImpl:async()=>new Response(null,{headers:{'Content-Length':'53000000'}})}),WechatPhotoError);
 const env=mockEnv();
 const over={item_list:Array.from({length:5},()=>item())};
 await assert.rejects(()=>persistWeChatPhotos(env,over,baby,'bot:message3',{fetchImpl:cdnFetch}),WechatPhotoError);
 assert.equal(env.objects.size,0);
 assert.equal(photoRecordId('abc'),photoRecordId('abc'));
 assert.notEqual(photoRecordId('abc'),photoRecordId('xyz'));
});

test('two media streams run concurrently but preserve independent durable IDs',async()=>{
 const env=mockEnv(),original=env.MEDIA.put.bind(env.MEDIA);
 let active=0,peak=0;
 env.MEDIA.put=async(...args)=>{
  active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,8));
  try{return await original(...args)}finally{active--}
 };
 const two={...raw,item_list:[item(),item()]};
 const reply=await persistWeChatPhotos(env,two,baby,'bot:parallel2',{fetchImpl:cdnFetch});
 assert.match(reply,/2 张照片/);
 assert.equal(peak,2);
 assert.equal(env.rows.size,2);
 assert.equal(new Set([...env.rows.values()].map(x=>x.object_key)).size,2);
});

test('large WeChat video pipelines at most two R2 parts and finalizes in numeric order',async()=>{
 const original=Buffer.alloc(19*1024*1024+123,7);
 original.writeUInt32BE(24,0);original.write('ftypisom',4);
 const enc=createCipheriv('aes-128-ecb',key,null);
 const encrypted=Buffer.concat([enc.update(original),enc.final()]);
 const video={type:5,video_item:{media:{full_url:'https://novac2c.cdn.weixin.qq.com/c2c/download?x=valid',aes_key:key.toString('base64')}}};
 let active=0,peak=0,completed=[],aborts=0,uploads=0;
 const bucket={
  async put(){throw Error('must use Multipart for large media')},
  async createMultipartUpload(k,options){
   assert.equal(options.httpMetadata.contentType,'video/mp4');
   return {
    async uploadPart(number,bytes){
     uploads++;active++;peak=Math.max(peak,active);
     await new Promise(resolve=>setTimeout(resolve,number===1?14:4));
     completed.push([number,Buffer.from(bytes)]);active--;
     return {etag:'test-etag-'+number};
    },
    async complete(parts){
     assert.equal(active,0);assert.deepEqual(parts.map(p=>p.partNumber),[1,2,3]);
     const body=Buffer.concat(completed.sort((a,b)=>a[0]-b[0]).map(x=>x[1]));
     assert.deepEqual(body,original);
    },
    async abort(){aborts++}
   };
  }
 };
 const out=await storeEncryptedMedia(bucket,'private/synthetic/video',video,
  {fetchImpl:async()=>new Response(encrypted)});
 assert.equal(out.size,original.length);assert.equal(out.mime,'video/mp4');
 assert.equal(uploads,3);assert.equal(peak,2);assert.equal(aborts,0);
});
test('WeChat multipart failure waits for in-flight parts then aborts without completing',async()=>{
 const original=Buffer.alloc(17*1024*1024,9);original.writeUInt32BE(24,0);original.write('ftypisom',4);
 const enc=createCipheriv('aes-128-ecb',key,null);
 const video={type:5,video_item:{media:{full_url:'https://novac2c.cdn.weixin.qq.com/c2c/download?x=valid',aes_key:key.toString('base64')}}};
 let active=0,aborted=0,completed=0;
 const bucket={
  async createMultipartUpload(){return{
   async uploadPart(number){
    active++;await new Promise(resolve=>setTimeout(resolve,number===1?2:10));active--;
    if(number===1)throw Error('R2_PART_FAILED');return {etag:String(number)};
   },
   async complete(){completed++},
   async abort(){assert.equal(active,0);aborted++}
  }}
 };
 await assert.rejects(()=>storeEncryptedMedia(bucket,'private/test/broken',video,
   {fetchImpl:async()=>new Response(Buffer.concat([enc.update(original),enc.final()]))}),/R2_PART_FAILED/);
 assert.equal(active,0);assert.equal(aborted,1);assert.equal(completed,0);
});

test('WeChat image caption is retained independently as media description',async()=>{
 const env=mockEnv();
 const message={...raw,item_list:[item(),{type:1,text_item:{text:'天气晴朗，一家人去公园散步'}}]};
 const reply=await persistWeChatPhotos(env,message,baby,'bot:caption-description',{fetchImpl:cdnFetch});
 assert.match(reply,/已保存/);
 assert.equal(env.rows.size,1);
 const saved=[...env.rows.values()][0];
 assert.equal(saved.description,'天气晴朗，一家人去公园散步');
 assert.equal(saved.title,saved.description);
 assert.equal(env.objects.size,1);
});
