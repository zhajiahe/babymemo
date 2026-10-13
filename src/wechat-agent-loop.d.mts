export interface AgentDecision {role:'assistant';content:string|null;tool_calls:Array<{id:string;type:'function';function:{name:string;arguments:string}}>};
export interface AgentLoopOptions {
 messages:any[]; tools:any[];
 complete:(options:{messages:any[];tools:any[];round:number})=>Promise<any>;
 execute:(call:AgentDecision['tool_calls'][number],stepOffset:number,round:number)=>Promise<string>|string;
 loadDecision?:(round:number)=>Promise<AgentDecision|null>;
 saveDecision?:(round:number,assistant:AgentDecision)=>Promise<void>;
 now?:()=>number;
 limits?:{rounds:number;tools:number;perRound:number;deadlineMs:number};
}
export const DEFAULT_AGENT_LIMITS:Readonly<{rounds:number;tools:number;perRound:number;deadlineMs:number}>;
export function runWechatAgentLoop(options:AgentLoopOptions):Promise<string>;
