export function isCommittedMutationReply(action:string,reply:string):boolean;
export function runWechatPlan(env:any,baby:any,calls:any[],opts:{messageId:string;text:string;groundedText?:string;at?:number;thread?:any;stepOffset?:number;referenceScope?:import('./wechat-context-snapshot.ts').MessageReferenceScope;encryptReply?:(text:string)=>Promise<string>;decryptReply?:(text:string)=>Promise<string>}):Promise<string>;
export function quickCommand(env:any,baby:any,text:string,thread:any,at?:number):Promise<string|null>;
