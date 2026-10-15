export function mediaSizeBand(size:number):string;
export function mediaTiming(options:{channel:string;stage:string;size:number;startedAt:number;status?:string;now?:()=>number;emit?:(message:string)=>void}):{level:string;event:string;channel:string;stage:string;status:string;sizeBand:string;durationMs:number};
export function mediaReadTiming(options:{kind:'thumbnail'|'original';status:number;size:number;d1Ms:number;r2Ms:number;totalMs:number;emit?:(line:string)=>void}):{level:string;event:string;kind:'thumbnail'|'original';status:number;sizeBand:string;d1Ms:number;r2Ms:number;totalMs:number};
