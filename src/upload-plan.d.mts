export interface PendingUploadMatch {id:string;title:string;size:number;mime:string;fingerprint:string;completedParts:number[]}
export function pickMatchingUpload<T extends PendingUploadMatch>(items:T[],file:{title:string;size:number;mime:string;fingerprint:string}):T|undefined;
export function remainingPartNumbers(total:number,completedParts:number[]):number[];
