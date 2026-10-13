export const CONTEXT_TTL_MS:number;
export function getActiveThread(saved:any,botId:string,userId:string,now?:number):any;
export function appendTurn(thread:any,user:string,reply:string,babyId:string,now?:number):any;
export function isClearContext(text:string):boolean;
export function buildCommandContext(text:string,thread:any,now?:number,babyId?:string):{modelMessages:Array<{role:string;content:string}>;groundedText:string;referencedId:string|null};

export function recordQuery(thread:any,babyId:string,kind:string,ids:string[],now?:number):void;
export function setPending(thread:any,babyId:string,action:string,text:string,args?:any,now?:number):void;
