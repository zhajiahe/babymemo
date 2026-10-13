// Structural guarantees belong to the executor, while the LLM handles intent.
export const MUTATING_ACTIONS=new Set<string>(['update_baby','create_growth','update_growth','delete_growth',
 'create_milestone','update_milestone','delete_milestone','update_media','delete_media',
 'restore_trash','update_recent_media']);
export function validDay(s:unknown):boolean{
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const d=new Date(s+'T00:00:00Z');
 return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;
}
export function messageTime(raw:unknown,now=Date.now()):number{
 const value=raw!==null&&typeof raw==='object'?(raw as {create_time_ms?:unknown}).create_time_ms:undefined;
 const n=Number(value);
 return Number.isFinite(n)&&n>now-30*86400000&&n<now+300000?n:now;
}
export function dayInZone(now:number,tz='Asia/Shanghai'):string{
 try{return new Date(now).toLocaleDateString('sv-SE',{timeZone:tz})}
 catch{return new Date(now).toISOString().slice(0,10)}
}
export function guardAction(action:string,_args:unknown,text:string):string|null{
 if(!MUTATING_ACTIONS.has(action))return null;
 if(typeof text==='string'&&/(?:不要|别|不许|禁止|无需|不用|不必|取消).{0,16}(?:新增|添加|记录|记下|保存|写入|修改|更新|更正|删除|删掉|恢复)/.test(text))
  return '用户明确表示不要执行此操作，未修改任何记录。';
 return null;
}
export function isCancel(text:string):boolean{return /^(取消|算了|不记了|不用了|取消操作)[。!！]?$/.test(String(text).trim())}
export function isUndo(text:string):boolean{return /^(撤销|撤回|恢复刚才的修改|撤销刚才的修改)[。!！]?$/.test(String(text).trim())}
