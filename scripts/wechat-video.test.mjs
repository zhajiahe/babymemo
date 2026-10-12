import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {storeEncryptedMedia,inspectVideo,mediaItems,videoItems,MAX_WECHAT_MEDIA_BYTES,WechatPhotoError} from '../src/wechat-media.mjs';
const key=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
const videoItem={type:5,video_item:{media:{encrypt_query_param:'test',aes_key:key.toString('base64')}}};
const encrypt=(plain)=>{const c=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(plain),c.final()])};
const mp4=(size)=>{
 const b=Buffer.alloc(size);b.writeUInt32BE(24,0);b.write('ftyp',4);b.write('isom',8);b.write('mp42',16);return b;
};
function fakeBucket(){
 const uploads=[],stored=new Map();
 return {uploads,stored,
 async put(key,bytes,opts){stored.set(key,{bytes:Buffer.from(bytes),type:opts.httpMetadata.contentType})},
 async createMultipartUpload(key,meta){
  const parts=[],info={key,meta,parts,completed:false,aborted:false};uploads.push(info);
  return {async uploadPart(n,bytes){parts.push(Buffer.from(bytes));return {etag:'etag-'+n}},
   async complete(manifest){assert.equal(manifest.length,parts.length);info.completed=true;stored.set(key,{bytes:Buffer.concat(parts),type:meta.httpMetadata.contentType})},
   async abort(){info.aborted=true}};
 }};
}
test('video-item (type 5) is detected without exposing other attachment formats',()=>{
 assert.equal(videoItems({item_list:[videoItem]}).length,1);
 assert.equal(mediaItems({item_list:[videoItem,{type:4,file_item:{media:{}}}]}).length,1);
 assert.equal(inspectVideo(mp4(128)),'video/mp4');
 const mov=mp4(128);mov.write('qt  ',8);assert.equal(inspectVideo(mov),'video/quicktime');
 const webm=Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0,0,0,0,0]);assert.equal(inspectVideo(webm),'video/webm');
 assert.throws(()=>inspectVideo(Buffer.from('<html>file</html>')),WechatPhotoError);
});
test('large video streams to R2 multipart and preserves MIME and original bytes',async()=>{
 const original=mp4(8*1024*1024+70000),ciphertext=encrypt(original),bucket=fakeBucket();
 const saved=await storeEncryptedMedia(bucket,'private/baby/video1',videoItem,{fetchImpl:async()=>new Response(ciphertext)});
 assert.equal(saved.mime,'video/mp4');assert.equal(saved.size,original.length);
 assert.equal(bucket.uploads.length,1);assert.equal(bucket.uploads[0].completed,true);
 assert.equal(bucket.uploads[0].meta.httpMetadata.contentType,'video/mp4');
 assert.deepEqual(bucket.stored.get('private/baby/video1').bytes,original);
});
test('50 MiB limit applies to both images and video, rejecting oversized encrypted header',async()=>{
 assert.equal(MAX_WECHAT_MEDIA_BYTES,50*1024*1024);
 const bucket=fakeBucket();
 await assert.rejects(()=>storeEncryptedMedia(bucket,'private/baby/video2',videoItem,{
  fetchImpl:async()=>new Response(null,{headers:{'Content-Length':String(MAX_WECHAT_MEDIA_BYTES+1024)}})
 }),WechatPhotoError);
 assert.equal(bucket.stored.size,0);
});
test('failed multipart upload aborts rather than indexing partial R2 media',async()=>{
 const original=mp4(8*1024*1024+70000),ciphertext=encrypt(original);
 let aborted=false;
 const bucket={async createMultipartUpload(){return {
   async uploadPart(){throw Error('R2 failure')},async complete(){},async abort(){aborted=true}
 }}};
 await assert.rejects(()=>storeEncryptedMedia(bucket,'private/baby/video3',videoItem,{fetchImpl:async()=>new Response(ciphertext)}),/R2 failure/);
 assert.equal(aborted,true);
});
