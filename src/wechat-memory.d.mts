export const CONTEXT_TTL_MS:number;
export function getActiveThread(saved:any,botId:string,userId:string,now?:number):any;
export function appendTurn(thread:any,user:string,reply:string,babyId:string,now?:number):any;
export function isClearContext(text:string):boolean;
export function buildCommandContext(text:string,thread:any):{modelMessages:Array<{role:string;content:string}>;groundedText:string;referencedId:string|null};
