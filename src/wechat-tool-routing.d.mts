export function readOnlyFallbackTool(text:string):string|null;
export function retryReadOnlyTool(options:{command:string;tools:any[];messages:unknown[];complete:(args:any)=>Promise<any>}):Promise<any[]|null>;
