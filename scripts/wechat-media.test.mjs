import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {decodeWeChatAesKey,wechatCdnUrl,downloadWeChatImage,persistWeChatPhotos,photoRecordId,WechatPhotoError,wechatMediaErrorCode} from '../src/wechat-media.mjs';

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
           const [id,baby_id,day,title,object_key,mime,size,created_at,thumbnail_ready,source_message_id]=op.params;
           if(!rows.has(source_message_id))rows.set(source_message_id,{id,baby_id,day,title,object_key,mime,size,created_at,thumbnail_ready,source_message_id});
         }
         return {meta:{changes:1}};
       }
     };
   }},
   MEDIA:{
     async head(key){const x=objects.get(key);return x?{size:x.bytes.length,httpMetadata:{contentType:x.mime}}:null},
     async put(key,bytes,opts){objects.set(key,{bytes:new Uint8Array(bytes),mime:opts?.httpMetadata?.contentType});return {etag:'fake'}}
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
