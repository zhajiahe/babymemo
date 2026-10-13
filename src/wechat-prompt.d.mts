export function wechatSystemPrompt(options:{babyName:string;localDay:string;timeZone:string}):string;
export function wechatFinalMessages(options:{command:string;babyName:string;localDay:string;observations:Array<{name:string;content:string}>;committedKinds:Set<string>;failedWrite:boolean;}):Array<{role:string;content:string}>;
