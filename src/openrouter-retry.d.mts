export const DEEPSEEK_V41_FLASH:'deepseek/deepseek-v4.1-flash';
export function openRouterReasoningForModel(model:string,mode?:'auto'|'off'|'low'):{enabled:boolean;effort?:'low'}|null;
export function retryAfterMs(value:string|null,now?:number):number|null;
export function openRouterCompletion(options:{key:string;model:string;messages:unknown[];tools?:unknown[];tool_choice?:'auto'|'none'|'required'|{type:'function';function:{name:string}};max_tokens?:number;fetchImpl?:typeof fetch;sleep?:(ms:number)=>Promise<unknown>;maxAttempts?:number;now?:()=>number;random?:()=>number;reasoningMode?:'auto'|'off'|'low'}):Promise<any>;
export function friendlyOpenRouterError(error:unknown):string|null;
