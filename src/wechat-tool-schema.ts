// Tool schemas are separate from the DB executor: the model cannot issue arbitrary SQL.
export type WechatBaby={id:string;name:string;birthday:string;allergies:string;notes:string;time_zone:string;birth_time?:string;[key:string]:unknown};
const str={type:'string'};
const day={type:'string',description:'真实公历日期 YYYY-MM-DD'};
const number=(unit:string,max:number)=>({type:'number',description:unit+'（必须是用户明确给出的数值）',exclusiveMinimum:0,maximum:max});
const selector={id:{type:'string',description:'查询结果中的记录编号，至少前 8 位'},day:{type:'string',description:'唯一匹配记录的日期 YYYY-MM-DD；同日多条时需要记录编号'}};
const tool=(name:string,description:string,properties:Record<string,unknown>={},required:string[]=[])=>({type:'function' as const,function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const wechatTools=[
 tool('get_runtime_context','读取消息发出时的可信时间、宝宝时区和目标宝宝；只有需要消歧时才调用'),
 tool('list_babies','列出这个家庭已经创建的宝宝'),
 tool('get_baby','读取当前宝宝档案（含生日及消息当天的准确年龄）'),
 tool('update_baby','修改宝宝档案，只根据用户明确说出的字段修改',{name:str,allergies:str,notes:str,birthday:day,birthTime:{type:'string',description:'出生时间 HH:mm'}}),
 tool('list_growth','查询成长测量，结果中含记录编号',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('create_growth','新增一条体重/身高/头围测量，必须有用户明确提供的数值和单位',{day,weight:number('kg',150),height:number('cm',250),headCircumference:number('cm',100),notes:str},['day']),
 tool('update_growth','更正已有测量，只修改用户明确要求变动的字段',{...selector,weight:number('kg',150),height:number('cm',250),headCircumference:number('cm',100),notes:str}),
 tool('delete_growth','把唯一一条测量移入 30 天回收站，必须有删除意图且有明确目标',selector),
 tool('list_milestones','查询成长事件，结果中含记录编号',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('create_milestone','新增一条成长事件',{day,title:str,description:str},['day','title']),
 tool('update_milestone','修改某条成长事件标题/描述/日期',{...selector,newDay:day,title:str,description:str}),
 tool('delete_milestone','把唯一一条成长事件移入 30 天回收站，必须有删除意图',selector),
 tool('list_media','列出相册里的照片和视频（仅元数据），支持日期筛选',{day,limit:{type:'integer',minimum:1,maximum:10}}),
 tool('update_media','修改指定照片或视频的拍摄日期及描述，description 可设为空字符串以清除',{...selector,newDay:day,description:str}),
 tool('delete_media','把一项相册内容移入 30 天回收站，必须有删除意图',selector),
 tool('list_trash','查看当前宝宝的回收站',{kind:{type:'string',enum:['growth','milestones','media']}}),
 tool('restore_trash','从回收站中恢复一项内容',{kind:{type:'string',enum:['growth','milestones','media']},...selector},['kind']),
 tool('search_records','按关键词和日期范围查询记录',{kind:{type:'string',enum:['growth','milestones','media']},startDay:day,endDay:day,keyword:str,limit:{type:'integer',minimum:1,maximum:10}},['kind']),
 tool('growth_summary','汇总区间内体重身高头围',{startDay:day,endDay:day},['startDay','endDay']),
 tool('update_recent_media','修改刚发送的一批照片或视频的拍摄日期或描述',{newDay:day,description:str})
];
export const wechatHelp='BabyMemo 微信操作\n可以直接发送：\n· 宝宝今天体重 10.5 kg，身高 80 cm\n· 查宝宝最近五次体重\n· 宝宝今天会走路了\n· 查宝宝的里程碑 / 相册\n· 把宝宝 10 月 1 日的体重改成 10.2 kg\n· 删除宝宝 10 月 1 日的成长记录\n· 查看宝宝的回收站 / 恢复编号 12345678\n· 直接发送照片或视频，可在附文写描述（单个 50 MiB 上限）\n· 把刚才那张照片描述改为“第一次去公园”\n· 查询后说“把第一条改成……”可连续操作；发送“清除上下文”重置记忆（多宝宝请先设置默认收图宝宝）\n同一天有多条时，先查询记录并使用回复里的编号。删除后可在 30 天内恢复。支持绑定微信的私聊文字与照片。';