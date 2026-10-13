import {createDecipheriv} from 'node:crypto';
import {decodeWeChatAesKey,wechatCdnUrl} from './wechat-media.mjs';
import {resolveOpenRouterKey} from './crypto.ts';
import {parseWechatIncoming,type ParsedWechatIncoming,type WechatItem} from './wechat-forward.ts';
import type {Env} from './types';

type ResponseFetch=typeof fetch;
type MediaReference={encrypt_query_param?:string;aes_key?:string;full_url?:string};
const AUDIO_LIMIT=4*1024*1024, TEXT_LIMIT=512*1024;
/** Read only allowlisted encrypted WeChat CDN objects, never arbitrary web URLs. */
export async function readWechatEncryptedAttachment(media:MediaReference,key:string,maxBytes:number,fetchImpl:ResponseFetch=fetch):Promise<Uint8Array>{
 if(maxBytes<1||maxBytes>AUDIO_LIMIT)throw Error('WECHAT_ATTACHMENT_INVALID_SIZE');
 const url=wechatCdnUrl(media);
 const secret=decodeWeChatAesKey(key);
 const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
 if(response.status>=300&&response.status<400)throw Error('WECHAT_ATTACHMENT_REDIRECT');
 if(!response.ok||!response.body)throw Error('WECHAT_ATTACHMENT_UNAVAILABLE');
 if(Number(response.headers.get('content-length')||0)>maxBytes+16)throw Error('WECHAT_ATTACHMENT_TOO_LARGE');
 const reader=response.body.getReader();
 const cipher=createDecipheriv('aes-128-ecb',secret,Buffer.alloc(0));
 const chunks:Buffer[]=[];
 let length=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   if(!value?.byteLength)continue;
   length+=value.byteLength;
   if(length>maxBytes+16)throw Error('WECHAT_ATTACHMENT_TOO_LARGE');
   chunks.push(cipher.update(value));
  }
  if(!length||length%16!==0)throw Error('WECHAT_ATTACHMENT_INVALID_CIPHER');
  chunks.push(cipher.final());
  const output=Buffer.concat(chunks);
  if(output.length>maxBytes)throw Error('WECHAT_ATTACHMENT_TOO_LARGE');
  return output;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export async function transcribeWechatVoice(env:Env,item:WechatItem,fetchImpl:ResponseFetch=fetch):Promise<string|null>{
 const voice=item.voice_item;
 if(typeof voice?.text==='string'&&voice.text.trim())return voice.text.trim();
 // WeChat's default SILK/AMR/Speex codecs are NOT accepted as MP3.
 // Only attempt the audio API when iLink explicitly declares MP3.
 if(voice?.encode_type!==7||!voice.media)return null;
 const key=voice.media.aes_key;
 if(!key)return null;
 const openRouterKey=await resolveOpenRouterKey(env);
 if(!openRouterKey)return null;
 const bytes=Buffer.from(await readWechatEncryptedAttachment(voice.media,key,AUDIO_LIMIT,fetchImpl));
 if(!(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)))return null;
 const reply=await fetchImpl('https://openrouter.ai/api/v1/audio/transcriptions',{
  method:'POST',headers:{Authorization:'Bearer '+openRouterKey,'Content-Type':'application/json'},
  body:JSON.stringify({model:'openai/whisper-1',input_audio:{format:'mp3',data:bytes.toString('base64')},language:'zh'}),
  signal:AbortSignal.timeout(30000),redirect:'manual'
 });
 if(!reply.ok)return null;
 const answer=await reply.json() as {text?:unknown};
 return typeof answer?.text==='string'&&answer.text.trim()?answer.text.trim().slice(0,1500):null;
}
export async function hydrateWechatIncoming(env:Env,raw:Record<string,unknown>,base:ParsedWechatIncoming,fetchImpl:ResponseFetch=fetch):Promise<ParsedWechatIncoming>{
 const items=Array.isArray(raw.item_list)?raw.item_list as WechatItem[]:[];
 const notes:string[]=[];
 // Best effort: forwarded XML/TXT files may carry merged text history.
 // Do not read other documents, media URLs, or arbitrary MIME types.
 for(const item of items.slice(0,16)){
  const file=item?.file_item;
  const filename=typeof file?.file_name==='string'?file.file_name:'';
  if(item?.type!==4||!/^.{1,100}\.(?:txt|xml)$/i.test(filename)||!file?.media?.aes_key)continue;
  try{
   const bytes=await readWechatEncryptedAttachment(file.media,file.media.aes_key,TEXT_LIMIT,fetchImpl);
   const material=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(/[\0]/.test(material))continue;
   const nested=parseWechatIncoming({item_list:[{type:1,text_item:{text:material}}]});
   if(nested.text){notes.push('[微信转发文件 '+filename+']\n'+nested.text);base.forwarded=true;base.missingMedia=Math.max(0,base.missingMedia-1)+nested.missingMedia}
  }catch{/* Untrusted or expired file content must not block other messages. */}
 }
 // Best effort speech-to-text for a real MP3 wire payload when native ASR is absent.
 // Max four items per message, and never infer a transcript from an unsupported codec.
 for(const item of items.slice(0,4)){
  if(item?.type!==3||typeof item.voice_item?.text==='string'&&item.voice_item.text.trim())continue;
  try{
   const transcript=await transcribeWechatVoice(env,item,fetchImpl);
   if(transcript){notes.push('[语音转写] '+transcript);base.missingVoice=false}
  }catch{/* Preserve explicit missing-audio notice in the parsed result. */}
 }
 if(!notes.length)return base;
 const next=base.text+'\n'+notes.join('\n');
 return {...base,text:next.slice(0,3000),limited:base.limited||next.length>3000};
}
