export const MUTATING_ACTIONS: Set<string>;
export function validDay(s:unknown):boolean;
export function messageTime(raw:any,now?:number):number;
export function dayInZone(now:number,tz?:string):string;
export function guardAction(action:string,args:any,text:string,baby?:any,at?:number):string|null;
export function isCancel(text:string):boolean;
export function isUndo(text:string):boolean;
