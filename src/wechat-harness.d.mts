export type WechatBaby = {id:string; name:string; birthday:string; allergies:string; notes:string; time_zone:string};
export const wechatTools:Array<{type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}}>;
export const wechatHelp:string;
export function runWechatTool(env:any,baby:WechatBaby|null,action:string,args:Record<string,unknown>,messageId:string,originalText:string,options?:{at?:number;thread?:any}):Promise<string>;
