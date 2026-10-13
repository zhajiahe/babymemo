export function runWechatPlan(env:any,baby:any,calls:any[],opts:{messageId:string;text:string;groundedText?:string;at?:number;thread?:any;encryptReply?:(text:string)=>Promise<string>;decryptReply?:(text:string)=>Promise<string>}):Promise<string>;
export function quickCommand(env:any,baby:any,text:string,thread:any,at?:number):Promise<string|null>;
