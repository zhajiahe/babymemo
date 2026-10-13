// iLink message item type 3 may include WeChat's own ASR transcript.
// Treat it exactly as user-sent text; do not download or transcribe voice media.
export function wechatMessageText(raw){
 const items=Array.isArray(raw?.item_list)?raw.item_list:[];
 return items.map(item=>{
  if(item?.type===1&&typeof item?.text_item?.text==='string')return item.text_item.text.trim();
  if(item?.type===3&&typeof item?.voice_item?.text==='string')return item.voice_item.text.trim();
  return '';
 }).filter(Boolean).join('\n').trim();
}
export function hasWechatVoice(raw){
 return Array.isArray(raw?.item_list)&&raw.item_list.some(item=>item?.type===3);
}
