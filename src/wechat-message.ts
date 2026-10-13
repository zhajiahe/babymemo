import type {WechatIncoming} from './wechat-forward';
/** WeChat's own ASR is authoritative when present. No voice bytes go to the LLM. */
export function wechatMessageText(raw:WechatIncoming|unknown):string{
 const root=raw!==null&&typeof raw==='object'?raw as WechatIncoming:{};
 const items=Array.isArray(root.item_list)?root.item_list:[];
 return items.map(item=>{
  if(item?.type===1&&typeof item.text_item?.text==='string')return item.text_item.text.trim();
  if(item?.type===3&&typeof item.voice_item?.text==='string')return item.voice_item.text.trim();
  return '';
 }).filter(Boolean).join('\n').trim();
}
export function hasWechatVoice(raw:WechatIncoming|unknown):boolean{
 const root=raw!==null&&typeof raw==='object'?raw as WechatIncoming:{};
 return Array.isArray(root.item_list)&&root.item_list.some(item=>item?.type===3);
}
