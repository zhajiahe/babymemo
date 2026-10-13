import type {Env} from './types';
export function retentionCutoff(at?:number):string;
export function purgeDeletedMedia(env:Env,at?:number):Promise<void>;
