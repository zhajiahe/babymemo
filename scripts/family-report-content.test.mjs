import test from 'node:test';
import assert from 'node:assert/strict';
import {isGenericMediaTitle,reportMediaStories,reportMetrics,reportEditorialInstructions,reportEditorialInput,parseReportNarrative,renderFamilyReport} from '../src/family-report-content.mjs';
const week={kind:'week',start:'2026-10-12',end:'2026-10-18'};
const month={kind:'month',start:'2026-10-01',end:'2026-10-31'};
const growth=[{day:'2026-10-17',weight:13.45,height:null,head_circumference:null}];
const prior=[{day:'2026-07-04',weight:13,height:null,head_circumference:null}];
const baby={
 name:'小好',
 counts:{moments:3,photos:9,videos:6,measurements:1},
 metrics:reportMetrics(growth,prior,'week'),
 moments:[
  {day:'2026-10-16',title:'睡前点名',description:'叫爸爸、妈妈、被被、奶奶（吃奶）。爸爸不在时会反复叫爸爸。'},
  {day:'2026-10-15',title:'小厨房到货',description:'穿着小围裙玩新厨房玩具，很喜欢。'}
 ],
 media:[]
};
const narrative={title:'会点名的小好和新厨房',paragraphs:[
 '这一周，小好睡前要点名：爸爸、妈妈、被被，还有表示吃奶的“奶奶”。爸爸不在时，他还会不停地叫爸爸。',
 '新到的小厨房玩具让小好特别喜欢，戴上小围裙的样子被家人记了下来。'
]};
test('automatic camera and WeChat names never become family stories',()=>{
 for(const x of ['微信视频 2026-10-16','微信照片 2026-10-15','微信图片_20261015','IMG_1234.JPG','VID_20261012.mp4',''])assert.equal(isGenericMediaTitle(x),true,x);
 assert.equal(isGenericMediaTitle('和妈妈一起在公园追泡泡'),false);
 assert.deepEqual(reportMediaStories([
  {day:'2026-10-16',mime:'video/mp4',title:'微信视频 2026-10-16',description:''},
  {day:'2026-10-15',mime:'image/jpeg',title:'微信照片 2026-10-15',description:'今天跟爸爸一起逛公园'},
  {day:'2026-10-14',mime:'image/jpeg',title:'坐在小凳子上',description:''}
 ],4),[
  {day:'2026-10-15',type:'照片',caption:'今天跟爸爸一起逛公园'},
  {day:'2026-10-14',type:'照片',caption:'坐在小凳子上'}
 ]);
});
test('weekly indicators do not imply weekly change from July to October',()=>{
 assert.deepEqual(reportMetrics(growth,prior,'week'),['体重 13.45 kg（10月17日测量）']);
 assert.deepEqual(reportMetrics(growth,prior,'month'),['体重 13.45 kg（10月17日测量）']);
 assert.deepEqual(reportMetrics(growth,[{...prior[0],day:'2026-10-02'}],'month'),['体重 13.45 kg（10月17日测量）；较10月2日+0.45 kg']);
 assert.deepEqual(reportMetrics([{day:'2026-10-17',weight:null,height:null,head_circumference:null}],prior,'week'),[]);
});
test('model prompt preserves family nicknames and forbids invented camera events',()=>{
 const sys=reportEditorialInstructions('week');
 assert.match(sys,/奶奶（吃奶）/);
 assert.match(sys,/不得猜测画面/);
 assert.match(sys,/第一次/);
 assert.match(reportEditorialInstructions('month'),/月报/);
});
test('AI response is validated structured title plus paragraphs',()=>{
 assert.deepEqual(parseReportNarrative(JSON.stringify(narrative)),narrative);
 assert.deepEqual(parseReportNarrative(String.fromCharCode(96).repeat(3)+'json\n'+JSON.stringify(narrative)+'\n'+String.fromCharCode(96).repeat(3)),narrative);
 for(const bad of ['',null,'随便写两句',JSON.stringify({title:'好',paragraphs:[]})])assert.throws(()=>parseReportNarrative(bad),/REPORT_AI_INVALID_RESPONSE/);
});
test('week opens with real story, not a duplicate database list',()=>{
 const result=renderFamilyReport(week,[baby],narrative);
 assert.match(result,/🌱 小好的这一周/);
 assert.ok(result.indexOf('会点名的小好和新厨房')<result.indexOf('📒 本期成长足迹'));
 assert.match(result,/✨ 3 个瞬间 · 📷 9 张照片 · 🎬 6 段视频/);
 assert.match(result,/体重 13.45 kg（10月17日测量）/);
 assert.doesNotMatch(result,/2026-07-04|微信照片 2026-10-15/);
 assert.ok(result.length<=1750);
});
test('month handles multiple babies with distinguishable summaries',()=>{
 const sibling={...baby,name:'二宝',counts:{moments:1,photos:2,videos:0,measurements:0},metrics:[]};
 const result=renderFamilyReport(month,[baby,sibling],narrative);
 assert.match(result,/家人的10月成长记/);
 assert.match(result,/2026年10月/);
 assert.match(result,/【小好】/);
 assert.match(result,/【二宝】/);
 assert.match(result,/📷 2 张照片/);
});
test('large family editorial prompt remains valid JSON with intact counts',()=>{
 const babies=Array.from({length:12},(_,i)=>({...baby,name:'宝宝'+i,
  moments:Array.from({length:25},(_,j)=>({day:'2026-10-16',title:'每天的故事'+j,description:'孩子喜欢和家人一起阅读绘本，然后坐在小桌子前画画。'.repeat(12)}))
 }));
 const raw=reportEditorialInput(month,babies);
 assert.ok(raw.length<=14500,String(raw.length));
 const parsed=JSON.parse(raw);
 assert.equal(parsed.babies.length,12);
 assert.equal(parsed.babies[11].counts.photos,9);
});
test('long narrative cannot truncate the verified numbers in WeChat',()=>{
 const long={title:'与家人一起的十月',paragraphs:Array.from({length:4},()=>('今天和家人在一起，记下了许多值得记住的生活。').repeat(15))};
 const result=renderFamilyReport(month,[baby],long);
 assert.ok(result.length<=1750,String(result.length));
 assert.match(result,/✨ 3 个瞬间/);
 assert.match(result,/体重 13.45 kg/);
});
