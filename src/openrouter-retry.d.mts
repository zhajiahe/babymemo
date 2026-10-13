export function retryAfterMs(value:string|null,now?:number):number|null;
export function openRouterCompletion(options:{key:string;model:string;messages:unknown[];tools?:unknown[];tool_choice?:'auto'|'none'|'required'|{type:'function';function:{name:string}};max_tokens?:number;fetchImpl?:typeof fetch;sleep?:(ms:number)=>Promise<unknown>;maxAttempts?:number;now?:()=>number;random?:()=>number}):Promise<any>;
export function friendlyOpenRouterError(error:unknown):string|null;
