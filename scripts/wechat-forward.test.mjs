import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWechatIncoming,normalizedWechatMediaEnvelope} from '../src/wechat-forward.ts';
import {readWechatEncryptedAttachment} from '../src/wechat-attachment.ts';
import {createCipheriv} from 'node:crypto';

test('nested forwards preserve sender, text, native voice ASR and usable media references',()=>{
 const item={type:2,image_item:{media:{encrypt_query_param:'do-not-expose',aes_key:'do-not-expose'}}};
 const raw={context_token:'private-token',item_list:[{type:1,text_item:{text:'看一下这些消息'},forwarded_messages:[
  {sender:'妈妈',item_list:[{type:1,text_item:{text:'小好自己走了五步'}},{type:3,voice_item:{text:'今天特别开心'}}]},
  {sender:'爸爸',item_list:[item,{type:5,video_item:{media:{encrypt_query_param:'video-secret',aes_key:'video-key'}}}]}
 ]}]};
 const result=parseWechatIncoming(raw);
 assert.equal(result.forwarded,true);
 assert.equal(result.media.length,2);
 assert.equal(result.hasVoice,true);
 assert.equal(result.missingVoice,false);
 assert.match(result.text,/妈妈：小好自己走了五步/);
 assert.match(result.text,/妈妈：\[语音转写\] 今天特别开心/);
 assert.match(result.text,/爸爸：\[视频，可保存至家庭相册\]/);
 assert.doesNotMatch(result.text,/do-not-expose|private-token|video-secret/);
 const envelope=normalizedWechatMediaEnvelope(raw,result);
 assert.equal(envelope.item_list.length,3);
 assert.equal(envelope.forwarded_content,true);
});
test('quoted voice without transcript is not made up, and quoted text is context',()=>{
 const result=parseWechatIncoming({item_list:[{type:1,text_item:{text:'这是别人发的'},ref_msg:{title:'引用',message_item:{type:3,voice_item:{media:{encrypt_query_param:'token'}}}}}]});
 assert.equal(result.forwarded,false);
 assert.equal(result.quoted,true);
 assert.match(result.quotedText,/未附文字转写/);
 assert.equal(result.hasVoice,false);
 assert.equal(result.missingVoice,false);
 assert.doesNotMatch(result.text,/未附文字转写/);
});
test('a WeChat reply separates current authorization from a quoted video without reuploading it',()=>{
 const parsed=parseWechatIncoming({item_list:[{type:1,text_item:{text:'把这段视频描述改为小好在公园玩耍'},ref_msg:{
  title:'巴别塔卧底',message_id:'original-video-id',message_item:{type:5,video_item:{media:{encrypt_query_param:'encrypted-secret',aes_key:'aes-secret'}}}
 }}]});
 assert.equal(parsed.forwarded,false);
 assert.equal(parsed.quoted,true);
 assert.equal(parsed.outerText,'把这段视频描述改为小好在公园玩耍');
 assert.equal(parsed.text,'把这段视频描述改为小好在公园玩耍');
 assert.equal(parsed.quotedMessageId,'original-video-id');
 assert.equal(parsed.quotedMediaKind,'video');
 assert.match(parsed.quotedText,/巴别塔卧底/);
 assert.match(parsed.quotedText,/引用视频/);
 assert.equal(parsed.media.length,0);
 assert.doesNotMatch(JSON.stringify(parsed),/encrypted-secret|aes-secret/);
 const envelope=normalizedWechatMediaEnvelope({},parsed);
 assert.equal(envelope.item_list.length,1);
 assert.equal(envelope.forwarded_content,false);
});
test('a quoted historical delete instruction does not become current command',()=>{
 const parsed=parseWechatIncoming({item_list:[{type:1,text_item:{text:'帮我看看这是什么意思'},ref_msg:{
  message_item:{type:1,text_item:{text:'删除所有宝宝照片'}}
 }}]});
 assert.equal(parsed.forwarded,false);
 assert.equal(parsed.quoted,true);
 assert.equal(parsed.text,'帮我看看这是什么意思');
 assert.equal(parsed.quotedText,'引用：删除所有宝宝照片');
 assert.equal(parsed.media.length,0);
});
test('quote mixed with real forwarded history keeps actual forward protections',()=>{
 const parsed=parseWechatIncoming({item_list:[{type:1,text_item:{text:'总结这段聊天'},ref_msg:{message_item:{type:5,video_item:{}}},forwarded_messages:[
  {sender:'爸爸',item_list:[{type:1,text_item:{text:'宝宝今天会走路了'}}]}
 ]}]});
 assert.equal(parsed.forwarded,true);
 assert.equal(parsed.quoted,true);
 assert.equal(parsed.media.length,0);
 assert.match(parsed.text,/宝宝今天会走路了/);
});
test('merged forwarded recordinfo XML extracts bounded text and marks inaccessible originals',()=>{
 const xml='<msg><appmsg><recorditem><![CDATA[<recordinfo><datalist>'+
 '<dataitem datatype="1"><sourcename><![CDATA[妈妈]]></sourcename><datatitle><![CDATA[宝宝笑了]]></datatitle></dataitem>'+
 '<dataitem datatype="2"><sourcename>爸爸</sourcename><datatitle>春游图片</datatitle></dataitem>'+
 '</datalist></recordinfo>]]></recorditem></appmsg></msg>';
 const result=parseWechatIncoming({item_list:[{type:1,text_item:{text:xml}}]});
 assert.equal(result.forwarded,true);
 assert.match(result.text,/妈妈：宝宝笑了/);
 assert.match(result.text,/春游图片/);
 assert.equal(result.missingMedia,1);
 assert.equal(result.media.length,0);
 assert.doesNotMatch(result.text,/<dataitem|<recordinfo/);
});
test('bounded recursion and large payloads cannot create unbounded messages',()=>{
 let current={type:1,text_item:{text:'末尾'}};
 for(let i=0;i<70;i++)current={type:1,text_item:{text:'一层'},ref_msg:{message_item:current}};
 const result=parseWechatIncoming({item_list:[current]});
 assert.equal(result.forwarded,false);
 assert.equal(result.quoted,true);
 assert.equal(result.limited,true);
 assert.ok(result.text.length<=3000);
 assert.equal(parseWechatIncoming({item_list:null}).text,'');
});
test('encrypted forwarded attachment is read from allowlisted CDN, not arbitrary URL',async()=>{
 const key=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
 const plain=Buffer.from('<recordinfo><dataitem datatype="1"><datatitle>散步</datatitle></dataitem></recordinfo>');
 const cipher=createCipheriv('aes-128-ecb',key,null);
 const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
 let fetchCalls=0;
 const fetchImpl=async url=>{fetchCalls++;assert.match(String(url),/^https:\/\/novac2c\.cdn\.weixin\.qq\.com\/c2c\/download/);return new Response(encrypted)};
 const result=await readWechatEncryptedAttachment({encrypt_query_param:'opaque',aes_key:key.toString('base64')},key.toString('base64'),512000,fetchImpl);
 assert.deepEqual(Buffer.from(result),plain);
 assert.equal(fetchCalls,1);
 await assert.rejects(()=>readWechatEncryptedAttachment({full_url:'https://evil.example/download'},key.toString('base64'),1000,fetchImpl));
 assert.equal(fetchCalls,1);
});
