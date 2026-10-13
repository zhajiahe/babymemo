import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,join,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function markdownFiles(folder){
  if(!existsSync(folder))return [];
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const abs=join(folder,entry.name);
    if(entry.isDirectory())return markdownFiles(abs);
    return entry.isFile()&&extname(entry.name)==='.md'?[abs]:[];
  });
}
function stripFences(text){
  let fenced=false;
  return text.split('\n').filter(line=>{
    if(/^\s*(?:```|~~~)/.test(line)){fenced=!fenced;return false}
    return !fenced;
  }).join('\n');
}
function markdownLinks(file){
  const content=stripFences(readFileSync(file,'utf8'));
  return [...content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(match=>match[1].trim());
}
function localLink(file,link){
  if(/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link))return null;
  const bare=link.split('#')[0].split('?')[0];
  if(!bare)return null;
  const decoded=decodeURIComponent(bare.replace(/^<|>$/g,''));
  const target=decoded.startsWith('/')?resolve(root,'.'+decoded):resolve(dirname(file),decoded);
  if(relative(root,target).startsWith('..'))return {error:'escapes repository'};
  return {target};
}
test('README, engineering, agent and docs internal Markdown links resolve to real files',()=>{
  const files=[join(root,'README.md'),join(root,'AGENTS.md'),join(root,'ENGINEERING.md'),...markdownFiles(join(root,'docs'))];
  const errors=[];
  for(const file of files){
    for(const link of markdownLinks(file)){
      try{
        const target=localLink(file,link);
        if(target?.error)errors.push(relative(root,file)+': '+link+' ('+target.error+')');
        else if(target&&!existsSync(target.target))errors.push(relative(root,file)+': '+link+' (not found)');
      }catch(e){errors.push(relative(root,file)+': '+link+' ('+e.message+')')}
    }
  }
  assert.deepEqual(errors,[],'Broken documentation links should be fixed in the same PR');
});
test('canonical quality and deployment docs remain discoverable from README',()=>{
  const intro=readFileSync(join(root,'README.md'),'utf8');
  for(const filename of ['ENGINEERING.md','docs/DEPLOY.md','docs/github-action-deploy.md',
    'docs/agent-deploy.md','docs/qa-regression-matrix.md','docs/BACKUP.md'])
    assert.ok(intro.includes(filename),'README must link to '+filename);
});
test('one-click deployment provisions first, then migrates, then publishes',()=>{
  const scripts=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts;
  const deploy=scripts.deploy;
  const order=['npm run build','npm run provision:remote','node scripts/reconcile-birth-time.mjs',
    'wrangler d1 migrations apply DB --remote','wrangler deploy --keep-vars'];
  let last=-1;
  for(const command of order){
    const index=deploy.indexOf(command);
    assert.ok(index>last,'Unexpected/unsafe deploy order near: '+command);
    last=index;
  }
});
test('CI-gated GitHub auto-deploy retains secrets and checks schema before migration',()=>{
  const file=readFileSync(join(root,'.github/workflows/deploy.yml'),'utf8');
  assert.ok(file.includes('node scripts/reconcile-birth-time.mjs'));
  assert.ok(file.includes('node scripts/prepare-openrouter-secret.mjs'));
  assert.ok(file.includes('wrangler d1 migrations apply DB --remote'));
  assert.ok(file.includes('bash scripts/deploy-worker-with-retry.sh'));
  assert.ok(file.includes('secrets.OPENROUTER_API_KEY'));
  assert.ok(file.includes('github.event.workflow_run.conclusion == \'success\''));
  assert.doesNotMatch(file,/wrangler d1 delete|wrangler r2 bucket delete/);
});
