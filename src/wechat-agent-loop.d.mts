export interface AgentDecision {role:'assistant';content:string|null;tool_calls:Array<{id:string;type:'function';function:{name:string;arguments:string}}>};
export interface AgentLoopOptions {
 messages:any[]; tools:any[];
 complete:(options:{messages:any[];tools:any[];round:number})=>Promise<any>;
 execute:(call:AgentDecision['tool_calls'][number],stepOffset:number,round:number)=>Promise<string|{content:string;halt?:boolean;committed?:boolean}>|string|{content:string;halt?:boolean;committed?:boolean};
 finalize?:(options:{messages:any[];observations:Array<{name:string;content:string}>;reason:string;committedKinds:Set<string>;failedWrite:boolean})=>Promise<any>;
 validateFinal?:(options:{content:string;observations:Array<{name:string;content:string}>;committedKinds:Set<string>;failedWrite:boolean})=>boolean;
 fallbackReply?:(options:{observations:Array<{name:string;content:string}>;committedKinds:Set<string>;failedWrite:boolean})=>string|null;
 loadDecision?:(round:number)=>Promise<AgentDecision|null>;
 saveDecision?:(round:number,assistant:AgentDecision)=>Promise<void>;
 now?:()=>number;
 limits?:{rounds:number;tools:number;perRound:number;deadlineMs:number};
}
export const DEFAULT_AGENT_LIMITS:Readonly<{rounds:number;tools:number;perRound:number;deadlineMs:number}>;
export function runWechatAgentLoop(options:AgentLoopOptions):Promise<string>;
