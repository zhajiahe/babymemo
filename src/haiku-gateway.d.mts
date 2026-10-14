export const DEFAULT_HAIKU_MODEL:string;
export const HAIKU55_PRICES:Readonly<{input:number;output:number;cacheRead:number;cacheWrite:number}>;
export function toHaikuRequest(options:{messages:any[];tools?:any[];max_tokens?:number}):any;
export function fromHaikuResponse(response:any):any;
export function haikuGatewayCompletion(options:{run:(model:string,payload:any)=>Promise<any>;messages:any[];tools?:any[];max_tokens?:number;model?:string}):Promise<any>;
export function haiku55Cost(usage:any):null|{inputTokens:number;outputTokens:number;cacheReadTokens:number;cacheWriteTokens:number;estimatedUSD:number};
