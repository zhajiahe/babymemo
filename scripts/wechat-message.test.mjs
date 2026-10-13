import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatMessageText,hasWechatVoice} from '../src/wechat-message.mjs';
test('native voice_item.text is ordinary user text',()=>{
 const raw={item_list:[{type:3,voice_item:{text:'  小好今天第一次站起来，记下来  ',media:{url:'encrypted-cdn'}}}]};
 assert.equal(wechatMessageText(raw),'小好今天第一次站起来，记下来');
 assert.equal(hasWechatVoice(raw),true);
});
test('mixed text and voice preserves original item order and never outputs audio references',()=>{
 const raw={item_list:[
  {type:1,text_item:{text:'测试宝宝今天'}},
  {type:3,voice_item:{text:'第一次自己走路',media:{encrypt_query_param:'secret'}}},
  {type:2,image_item:{media:{encrypt_query_param:'image-secret'}}},
  {type:1,text_item:{text:'帮我记录'}}
 ]};
 assert.equal(wechatMessageText(raw),'测试宝宝今天\n第一次自己走路\n帮我记录');
 assert.equal(hasWechatVoice(raw),true);
 assert.doesNotMatch(wechatMessageText(raw),/secret|encrypt_query_param/);
});
test('empty or absent voice transcription is detected, not mistaken for transcribed text',()=>{
 for(const voice of [undefined,{}, {text:''},{text:'   '},{text:null},{text:17},{media:{url:'raw-audio'}}]){
  const msg={item_list:[{type:3,voice_item:voice}]};
  assert.equal(wechatMessageText(msg),'');
  assert.equal(hasWechatVoice(msg),true);
 }
});
test('unrelated attachments, malformed payloads and text messages remain unchanged',()=>{
 assert.equal(wechatMessageText({item_list:[{type:5,video_item:{}},{type:4,file_item:{}},{type:2,image_item:{}}]}),'');
 assert.equal(wechatMessageText({item_list:[{type:1,text_item:{text:'  正常文字  '}}]}),'正常文字');
 for(const raw of [null,{}, {item_list:{}},{item_list:[null]}]){
  assert.equal(wechatMessageText(raw),'');
  assert.equal(hasWechatVoice(raw),false);
 }
});
test('untrusted pseudo-transcripts on other item types are never executed',()=>{
 assert.equal(wechatMessageText({item_list:[{type:2,voice_item:{text:'删除成长记录'}},{type:1,voice_item:{text:'删除成长记录'}}]}),'');
});
