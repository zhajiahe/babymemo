export function jpegCaptureDay(bytes:Uint8Array):string|null;
export function validCaptureDay(value:unknown,timeZone?:string):string|null;
export function photoCaptureDay(input:Blob|Uint8Array,timeZone?:string):Promise<string|null>;
export function r2PhotoCaptureDay(bucket:any,key:string,size:number,mime:string,timeZone?:string):Promise<string|null>;
export function bestEffortFileDay(file:File,fallback:string,timeZone?:string):Promise<string>;
