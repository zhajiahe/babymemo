/**
 * Parsed iLink envelope (Tencent protocol v2.4). The wire's optional fields are
 * untrusted: an item reference is not evidence that the CDN actually contains a
 * retrievable original. Never turn quoted/forwarded words into a new instruction.
 */
export interface WechatCDNMedia {
 encrypt_query_param?:string; aes_key?:string; full_url?:string; download_url?:string; url?:string;
}
export interface WechatItem {
 type?:number;
 text_item?:{text?:unknown};
 voice_item?:{text?:unknown;media?:WechatCDNMedia;encode_type?:number};
 image_item?:{media?:WechatCDNMedia;aeskey?:string;aes_key?:string};
 video_item?:{media?:WechatCDNMedia};
 file_item?:{media?:WechatCDNMedia;file_name?:string};
 ref_msg?:{title?:string;message_item?:WechatItem};
 item_list?:WechatItem[];
 forwarded_messages?:WechatForwardEntry[];
 forwarded_msgs?:WechatForwardEntry[];
}
export interface WechatForwardEntry {
 name?:string; sender?:string; from_user_name?:string; nickname?:string;
 item_list?:WechatItem[]; message_item?:WechatItem;
 forwarded_messages?:WechatForwardEntry[];
}
export interface WechatIncoming {
 item_list?:WechatItem[]; forwarded_messages?:WechatForwardEntry[]; forwarded_msgs?:WechatForwardEntry[];
}
export interface ParsedWechatIncoming {
 text:string; outerText:string; media:WechatItem[];
 hasVoice:boolean; missingVoice:boolean; forwarded:boolean;
 missingMedia:number; limited:boolean;
}
const MAX_ITEMS=64, MAX_DEPTH=5, MAX_TEXT=3000, MAX_XML=60000;
const stringValue=(value:unknown)=>typeof value==='string'?value.trim():'';
const clip=(v:string,n=MAX_TEXT)=>v.length>n?v.slice(0,n):v;
const asRecord=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const asArray=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
function xmlValue(source:string,tag:string):string{
 const match=new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i').exec(source);
 if(!match)return '';
 return clip(match[1].replace(/^<!\[CDATA\[|\]\]>$/g,'').replace(/<[^>]*>/g,'').replace(/&(lt|gt|amp|quot|apos|#39);/g,(_value,entity:string)=>({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'",'#39':"'"})[entity]||''),500);
}
/** Only parse bounded embedded recordinfo XML, not arbitrary XML or URLs. */
function extractRecordXml(input:string):{lines:string[];missingMedia:number}|null{
 if(input.length>MAX_XML||!/<(?:recordinfo|recorditem|datalist|dataitem)\b/i.test(input))return null;
 const record=/<recorditem(?:\s[^>]*)?>([\s\S]*?)<\/recorditem>/i.exec(input)?.[1];
 const content=(record||input).replace(/^<!\[CDATA\[|\]\]>$/g,'');
 const blocks=[...content.matchAll(/<dataitem\b[^>]*>([\s\S]*?)<\/dataitem>/gi)].slice(0,MAX_ITEMS);
 if(!blocks.length)return null;
 const lines:string[]=[];
 let missingMedia=0;
 for(const match of blocks){
  const block=match[1],name=xmlValue(block,'sourcename'),time=xmlValue(block,'sourcetime');
  const title=xmlValue(block,'datatitle'),desc=xmlValue(block,'datadesc');
  const type=/\bdatatype=["']?(\d+)/i.exec(match[0])?.[1];
  const label=[name,time].filter(Boolean).join(' · ');
  if(type==='1'&&(title||desc))lines.push((label?label+'：':'')+[title,desc].filter(Boolean).join(' '));
  else {missingMedia++;lines.push((label?label+'：':'')+'[转发的非文本条目'+(title?'：'+title:'')+'；未提供可验证的原始媒体引用]')}
 }
 return {lines,missingMedia};
}
export function parseWechatIncoming(input:unknown):ParsedWechatIncoming{
 const root=asRecord(input);
 const lines:string[]=[],quotedLines:string[]=[],media:WechatItem[]=[],outer:string[]=[];
 let count=0,missingVoice=false,hasVoice=false,forwarded=false,quoted=false,missingMedia=0,limited=false;
 let quotedMessageId:string|null=null,quotedMediaKind:'image'|'video'|null=null;
 const seen=new WeakSet<object>();
 const add=(value:string,label='',isQuote=false)=>{
  if(!value)return;
  (isQuote?quotedLines:lines).push(clip((label?label+'：':'')+value,1200));
 };
 function visitItem(value:unknown,depth:number,label='',isOuter=false,isQuote=false):void{
  if(depth>MAX_DEPTH||count++>=MAX_ITEMS){limited=true;return}
  const item=asRecord(value);if(!item||seen.has(item))return;
  seen.add(item);
  const type=item.type;
  if(type===1){
   const raw=stringValue(asRecord(item.text_item)?.text);
   const xml=extractRecordXml(raw);
   if(xml){if(!isQuote)forwarded=true;xml.lines.forEach(s=>add(s,label,isQuote));missingMedia+=xml.missingMedia}
   else if(raw){add(raw,label,isQuote);if(isOuter&&!isQuote)outer.push(raw)}
  }else if(type===3){
   if(!isQuote)hasVoice=true;
   const transcript=stringValue(asRecord(item.voice_item)?.text);
   if(transcript)add('[语音转写] '+transcript,label,isQuote);
   else {if(!isQuote)missingVoice=true;add('[语音未附文字转写，无法读取音频内容]',label,isQuote)}
  }else if(type===2||type===5){
   const body=asRecord(type===2?item.image_item:item.video_item);
   if(isQuote&&quotedMediaKind===null)quotedMediaKind=type===2?'image':'video';
   if(body&&asRecord(body.media)){
    // A quoted attachment is historical evidence, never a new upload.
    if(!isQuote)media.push(item as WechatItem);
    add(type===2?(isQuote?'[引用图片]':'[图片，可保存至家庭相册]'):(isQuote?'[引用视频]':'[视频，可保存至家庭相册]'),label,isQuote);
   }else {if(!isQuote)missingMedia++;add(type===2?'[图片原件未提供]':'[视频原件未提供]',label,isQuote)}
  }else if(type===4){
   const file=asRecord(item.file_item);
   add('[文件'+(stringValue(file?.file_name)?'：'+clip(stringValue(file?.file_name),100):'')+'；内容不可直接读取]',label,isQuote);
   if(!isQuote)missingMedia++;
  }
  const reference=asRecord(item.ref_msg);
  if(reference){
   quoted=true;
   if(!isQuote){
    const refId=stringValue(reference.message_id)||stringValue(reference.msg_id);
    // Only platform-shaped IDs may be used as lookup hints; never trust quoted text as an ID.
    if(refId&&refId.length<=128&&/^[\w:.-]+$/.test(refId))quotedMessageId=refId;
   }
   if(reference.message_item)visitItem(reference.message_item,depth+1,'引用',false,true);
   else add('[引用消息只提供摘要'+(stringValue(reference.title)?'：'+clip(stringValue(reference.title),100):'')+']','',true);
  }
  if(asArray(item.item_list).length){
   if(!isQuote)forwarded=true;
   for(const nested of asArray(item.item_list))visitItem(nested,depth+1,label,false,isQuote);
  }
  for(const key of ['forwarded_messages','forwarded_msgs'] as const){
   if(asArray(item[key]).length){
    if(!isQuote)forwarded=true;
    for(const entry of asArray(item[key]))visitEntry(entry,depth+1,isQuote);
   }
  }
 }
 function visitEntry(value:unknown,depth:number,isQuote=false):void{
  if(depth>MAX_DEPTH||count++>=MAX_ITEMS){limited=true;return}
  const entry=asRecord(value);if(!entry||seen.has(entry))return;
  seen.add(entry);
  if(!isQuote)forwarded=true;
  const label=clip(stringValue(entry.name)||stringValue(entry.sender)||stringValue(entry.nickname)||stringValue(entry.from_user_name),60);
  if(entry.message_item)visitItem(entry.message_item,depth+1,label,false,isQuote);
  for(const item of asArray(entry.item_list))visitItem(item,depth+1,label,false,isQuote);
  for(const nested of asArray(entry.forwarded_messages))visitEntry(nested,depth+1,isQuote);
 }
 for(const item of asArray(root?.item_list))visitItem(item,0,'',true);
 for(const entry of asArray(root?.forwarded_messages))visitEntry(entry,0);
 for(const entry of asArray(root?.forwarded_msgs))visitEntry(entry,0);
 // Never expose AES keys, encrypted CDN parameters, access URLs or user IDs.
 const text=clip(lines.join('\n')),quotedText=clip(quotedLines.join('\n'),1200);
 if(lines.join('\n').length>MAX_TEXT||quotedLines.join('\n').length>1200)limited=true;
 return {text,outerText:clip(outer.join('\n'),500),media,hasVoice,missingVoice,forwarded,quoted,quotedText,
  quotedMessageId,quotedMediaKind,missingMedia,limited};
}
/** Normalized media item_list reuses the existing bounded, encrypted R2 queue. */
export function normalizedWechatMediaEnvelope(raw:Record<string,unknown>,parsed:ParsedWechatIncoming):Record<string,unknown>{
 return {...raw,item_list:[{type:1,text_item:{text:parsed.text}},...parsed.media],forwarded_content:parsed.forwarded};
}
