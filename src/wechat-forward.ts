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
 const lines:string[]=[], media:WechatItem[]=[],outer:string[]=[];
 let count=0,missingVoice=false,hasVoice=false,forwarded=false,missingMedia=0,limited=false;
 const seen=new WeakSet<object>();
 const add=(text:string,label='')=>{if(!text)return;lines.push(clip((label?label+'：':'')+text,1200))};
 function visitItem(value:unknown,depth:number,label='',isOuter=false):void{
  if(depth>MAX_DEPTH||count++>=MAX_ITEMS){limited=true;return}
  const item=asRecord(value);if(!item||seen.has(item))return;
  seen.add(item);
  const type=item.type;
  if(type===1){
   const raw=stringValue(asRecord(item.text_item)?.text);
   const xml=extractRecordXml(raw);
   if(xml){forwarded=true;xml.lines.forEach(s=>add(s,label));missingMedia+=xml.missingMedia}
   else if(raw){add(raw,label);if(isOuter)outer.push(raw)}
  }else if(type===3){
   hasVoice=true;
   const transcript=stringValue(asRecord(item.voice_item)?.text);
   if(transcript)add('[语音转写] '+transcript,label);
   else {missingVoice=true;add('[语音未附文字转写，无法读取音频内容]',label)}
  }else if(type===2||type===5){
   const body=asRecord(type===2?item.image_item:item.video_item);
   if(body&&asRecord(body.media)){
    media.push(item as WechatItem);
    add(type===2?'[图片，可保存至家庭相册]':'[视频，可保存至家庭相册]',label);
   }else {missingMedia++;add(type===2?'[图片原件未提供]':'[视频原件未提供]',label)}
  }else if(type===4){
   const file=asRecord(item.file_item);
   add('[文件'+(stringValue(file?.file_name)?'：'+clip(stringValue(file?.file_name),100):'')+'；内容不可直接读取]',label);
   missingMedia++;
  }
  const reference=asRecord(item.ref_msg);
  if(reference){
   forwarded=true;
   if(reference.message_item)visitItem(reference.message_item,depth+1,'引用');
   else add('[引用消息只提供摘要'+(stringValue(reference.title)?'：'+clip(stringValue(reference.title),100):'')+']');
  }
  if(asArray(item.item_list).length){forwarded=true;for(const nested of asArray(item.item_list))visitItem(nested,depth+1,label)}
  for(const key of ['forwarded_messages','forwarded_msgs'] as const){
   if(asArray(item[key]).length){forwarded=true;for(const entry of asArray(item[key]))visitEntry(entry,depth+1)}
  }
 }
 function visitEntry(value:unknown,depth:number):void{
  if(depth>MAX_DEPTH||count++>=MAX_ITEMS){limited=true;return}
  const entry=asRecord(value);if(!entry||seen.has(entry))return;
  seen.add(entry);
  forwarded=true;
  const label=clip(stringValue(entry.name)||stringValue(entry.sender)||stringValue(entry.nickname)||stringValue(entry.from_user_name),60);
  if(entry.message_item)visitItem(entry.message_item,depth+1,label);
  for(const item of asArray(entry.item_list))visitItem(item,depth+1,label);
  for(const nested of asArray(entry.forwarded_messages))visitEntry(nested,depth+1);
 }
 for(const item of asArray(root?.item_list))visitItem(item,0,'',true);
 for(const entry of asArray(root?.forwarded_messages))visitEntry(entry,0);
 for(const entry of asArray(root?.forwarded_msgs))visitEntry(entry,0);
 // We intentionally omit raw encrypted CDN parameters, access keys and user IDs.
 const text=clip(lines.join('\n'));
 if(lines.join('\n').length>MAX_TEXT)limited=true;
 return {text,outerText:clip(outer.join('\n'),500),media,hasVoice,missingVoice,forwarded,missingMedia,limited};
}
/** Normalized media item_list reuses the existing bounded, encrypted R2 queue. */
export function normalizedWechatMediaEnvelope(raw:Record<string,unknown>,parsed:ParsedWechatIncoming):Record<string,unknown>{
 return {...raw,item_list:[{type:1,text_item:{text:parsed.text}},...parsed.media],forwarded_content:parsed.forwarded};
}
