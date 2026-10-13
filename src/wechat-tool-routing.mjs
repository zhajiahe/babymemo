// A no-tool response from a reasoning model should not block an obvious read-only
// WeChat query. Never force a mutating tool or guess record identifiers.
const WRITE_INTENT=/删除|删掉|移除|撤销|修改|更正|更改|更新|改成|改为|改一下|设为|标记|新增|添加|补充|记下|记入|帮我记|保存|恢复|还原|创建|设置|收藏/;
const QUERY_START=/^(?:请|帮我|给我)?\s*(?:查|查询|查一下|查看|看看|列出|找一下|找找|找出|给我看)/;
export function readOnlyFallbackTool(text){
 const t=String(text||'').trim();
 if(!t||t.length>350||!QUERY_START.test(t)||WRITE_INTENT.test(t))return null;
 if(/回收站|垃圾箱/.test(t))return 'list_trash';
 if(/相册|照片|图片|视频/.test(t))return 'list_media';
 if(/里程碑|成长瞬间|成长事件|第一次/.test(t))return 'list_milestones';
 if(/体重|身高|头围|测量|成长曲线|成长记录/.test(t))return 'list_growth';
 if(/宝宝档案|宝宝资料|出生日期|过敏档案/.test(t))return 'get_baby';
 return null;
}
