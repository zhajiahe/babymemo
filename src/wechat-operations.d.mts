export function operationSnapshot(kind:string,row:any):Record<string,unknown>|null;
export function auditChange(env:any,operation:any):Promise<string|null>;
export function undoOperation(env:any,babyId:string,opId:string):Promise<string>;
export function snapshotChanges(kind:string,before:any,changes:any):Record<string,unknown>;
