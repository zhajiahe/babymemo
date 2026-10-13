import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../src',import.meta.url));
function walk(dir){
 return readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(join(dir,item.name)):[join(dir,item.name)]);
}
test('core TypeScript coverage does not regress below the migrated baseline',()=>{
 const files=walk(root).filter(p=>/\.(?:tsx?|mjs)$/.test(p)&&!p.endsWith('.d.mts'));
 const typed=files.filter(p=>/\.tsx?$/.test(p));
 const coverage=typed.length/files.length;
 assert.ok(coverage>=0.52,'Typed source module coverage below 52%: '+typed.length+'/'+files.length);
 for(const p of ['wechat-forward.ts','wechat-attachment.ts','wechat-message.ts','wechat-policy.ts','wechat-status.ts']){
  const body=readFileSync(join(root,p),'utf8');
  assert.ok(body.includes('export '),'TypeScript module not implemented: '+p);
 }
});
