export const MAX_MEDIA_TASKS:number;
export function mediaTaskId(sourceId:string):Promise<string>;
export type MediaQueueStatus={pending:number;saving:boolean;notifying:boolean;retrying:boolean;lastError:{code:string;attempt:number;at:string}|null;lastCompleted:string|null};
export class DurableMediaQueue {
 constructor(storage:DurableObjectStorage,hooks:{permission:(payload:string)=>Promise<'active'|'paused'|'stale'>;execute:(payload:string)=>Promise<{payload:string;ok:boolean}>;failure:(payload:string,error:unknown,attempt:number)=>Promise<{payload:string;ok:boolean}|null>;deliver:(payload:string,result:string,clientId:string)=>Promise<void>;errorCode:(error:unknown)=>string});
 enqueue(sourceId:string,payload:string):Promise<{accepted:boolean;alreadyDone?:boolean}>;
 status():Promise<MediaQueueStatus>;
 start():Promise<void>;pause():Promise<void>;reset():Promise<string[]>;alarm():Promise<void>;
}
