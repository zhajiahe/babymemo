import test from 'node:test';import assert from 'node:assert/strict';
import {wechatStatusView} from '../src/wechat-status.mjs';
const now=Date.parse('2026-10-13T02:30:00Z');
const normal={connected:true,enabled:true,lastPoll:'2026-10-13T02:29:30Z',lastError:null,media:{pending:0,lastError:null}};
test('enabled is not presented as healthy until a recent poll has succeeded',()=>{
 assert.equal(wechatStatusView({...normal,lastPoll:null},now).label,'正在连接');assert.equal(wechatStatusView(normal,now).label,'运行正常');assert.equal(wechatStatusView({...normal,lastPoll:'2026-10-13T02:20:00Z'},now).label,'连接暂时中断');
});
test('connection errors, expired authorization and paused accounts have distinct recovery guidance',()=>{
 assert.equal(wechatStatusView({...normal,lastError:'POLL_OR_NETWORK_ERROR'},now).label,'连接重试中');assert.equal(wechatStatusView({...normal,enabled:false,lastError:'WECHAT_AUTH_EXPIRED'},now).label,'需要重新绑定');assert.equal(wechatStatusView({...normal,enabled:false},now).label,'已暂停');assert.equal(wechatStatusView({...normal,unavailable:true},now).label,'状态暂时无法获取');
});
test('saving, automatic retries and a terminal partial failure remain visible without provider data',()=>{
 assert.equal(wechatStatusView({...normal,media:{pending:1,notifying:true,retrying:true}},now).label,'结果通知重试中');
 assert.equal(wechatStatusView({...normal,media:{pending:2}},now).label,'媒体保存中');assert.equal(wechatStatusView({...normal,media:{pending:1,retrying:true}},now).label,'保存重试中');const view=wechatStatusView({...normal,media:{pending:0,lastError:{code:'WECHAT_CDN_HTTP_503',url:'private-cdn-url'}}},now);assert.equal(view.label,'部分媒体保存失败');assert.doesNotMatch(JSON.stringify(view),/503|url|private/);
});
