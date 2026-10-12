import assert from 'node:assert/strict';
import test from 'node:test';
import {wechatTools,wechatHelp,runWechatTool} from '../src/wechat-harness.mjs';
const baby={id:'baby-one',name:'小好',birthday:'2025-05-30',time_zone:'Asia/Shanghai',allergies:'蛋清',notes:''};
const calls=[];
const records=[
 {id:'aaaaaaaa-1111-2222-3333-444444444444',baby_id:'baby-one',day:'2026-10-01',weight:10,height:80,head_circumference:45,notes:''},
 {id:'bbbbbbbb-1111-2222-3333-444444444444',baby_id:'baby-one',day:'2026-10-01',weight:10.1,height:81,head_circumference:45,notes:''}
];
const fake=()=>({DB:{prepare(sql){const state={sql,params:[]};calls.push(state);return {
 bind(...p){state.params=p;return this},
 async all(){if(sql.includes('FROM growth_records')&&sql.includes('id LIKE'))return {results:records.filter(x=>x.id.startsWith(state.params[1].slice(0,-1))).slice(0,2)};
 if(sql.includes('FROM growth_records')&&sql.includes('day=?'))return {results:records.filter(x=>x.day===state.params[1]).slice(0,2)};
 if(sql.includes('FROM milestones'))return {results:[]};
 if(sql.includes('FROM babies'))return {results:[{name:'小好',birthday:'2025-05-30'}]};
 return {results:[]}},async first(){return null},async run(){return {meta:{changes:1}}}
 }}}});
test('tool registry provides bounded CRUD and recovery, no arbitrary SQL tool',()=>{
 const names=wechatTools.map(x=>x.function.name);
 for(const name of ['list_babies','get_baby','update_baby','list_growth','create_growth','update_growth','delete_growth','list_milestones','create_milestone','update_milestone','delete_milestone','list_media','update_media','delete_media','list_trash','restore_trash'])assert.ok(names.includes(name),name);
 assert.ok(names.every(x=>!x.startsWith('execute_sql')));
 assert.match(wechatHelp,/删除/);
});
test('deleting requires user to explicitly request deletion and unique target',async()=>{
 calls.length=0;
 let r=await runWechatTool(fake(),baby,'delete_growth',{id:'aaaaaaaa'},'x','查一下小好的体重');
 assert.match(r,/明确说“删除”/);assert.equal(calls.length,0);
 r=await runWechatTool(fake(),baby,'delete_growth',{day:'2026-10-01'},'x','删除小好的 10 月 1 日体重');
 assert.match(r,/有多条记录/);
 r=await runWechatTool(fake(),baby,'delete_growth',{id:'aaaaaaaa'},'x','删除小好的 aaaaaaaa 测量');
 assert.match(r,/移入回收站/);
 assert.ok(calls.some(x=>x.sql.includes('UPDATE growth_records SET deleted_at')));
});
test('update refuses absent selector and invalid measurement',async()=>{
 calls.length=0;
 const r=await runWechatTool(fake(),baby,'update_growth',{weight:10},'x','把小好的体重改成10kg');
 assert.match(r,/指定记录日期/);
 const bad=await runWechatTool(fake(),baby,'update_growth',{id:'aaaaaaaa',weight:999},'x','把小好的体重改成999kg');
 assert.match(bad,/不合法/);
 assert.equal(calls.filter(x=>x.sql.includes('UPDATE')).length,0);
});
test('queries are scoped to selected baby and list includes identifiable IDs',async()=>{
 calls.length=0;
 const r=await runWechatTool(fake(),baby,'list_growth',{day:'2026-10-01'},'x','查询小好的体重');
 assert.match(r,/aaaaaaaa/);assert.match(r,/bbbbbbbb/);
 assert.ok(calls.some(x=>x.sql.includes('baby_id=?')&&x.params[0]==='baby-one'));
});
test('creation validates date and does not write invented measurements',async()=>{
 calls.length=0;
 assert.match(await runWechatTool(fake(),baby,'create_growth',{day:'2026-02-31',weight:10},'x','小好10kg'),/有效日期/);
 assert.match(await runWechatTool(fake(),baby,'create_growth',{day:'2026-10-01'},'x','记录小好'),/请明确体重/);
 assert.equal(calls.filter(x=>x.sql.includes('INSERT')).length,0);
});
