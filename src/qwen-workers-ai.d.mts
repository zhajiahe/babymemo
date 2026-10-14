export declare const DEFAULT_QWEN_MODEL:'@cf/qwen/qwen3.8-27b';
export declare const DEFAULT_AI_PROVIDER:'workers-ai';
export declare const QWEN_REASONING_MODE:'off';
export function qwenRequest(options:{messages:unknown[];tools?:unknown[];max_tokens?:number}):any;
export function qwenCompletion(options:{ai?:{run:(model:string,payload:any)=>Promise<any>}|null;messages:unknown[];tools?:unknown[];max_tokens?:number}):Promise<any>;
export function friendlyWorkersAIError(error:unknown):string|null;
