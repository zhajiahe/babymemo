export function mapBounded<T,R>(items:T[],limit:number,work:(item:T,index:number)=>Promise<R>|R):Promise<Array<{status:'fulfilled';value:R}|{status:'rejected';reason:unknown}>>;
export function transferConcurrency(mobile:boolean,fileCount:number):{files:number;parts:number};
export const DIRECT_UPLOAD_LIMIT:number;
export function canDirectUpload(size:number):boolean;