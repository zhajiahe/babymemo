import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';

// Operator backup verification is deliberately exercised entirely offline.
// No Wrangler credentials, remote D1, production bucket, or family photos.
const root=resolve('.backup-private');
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=path=>spawnSync(process.execPath,['scripts/family-backup.mjs','verify',path],{
  cwd:process.cwd(),encoding:'utf8',timeout:10000
});
function fixture(){
  const dir=join(root,'qa-verify-'+process.pid+'-'+Date.now()+'-'+Math.random().toString(16).slice(2));
  mkdirSync(join(dir,'media'),{recursive:true,mode:0o700});
  const db=Buffer.from('CREATE TABLE regression (id INTEGER PRIMARY KEY);\n');
  const media=Buffer.from([1,2,3,4,5,6]);
  const key='private/baby/fixture.jpg';
  const file=sha(key).slice(0,32)+'.bin';
  const manifest={
    schema:'babymemo-full-backup-v1',
    database:{size:db.length,sha256:sha(db)},
    objects:[{key,file,size:media.length,sha256:sha(media)}]
  };
  const save=()=>writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));
  writeFileSync(join(dir,'database.sql'),db);
  writeFileSync(join(dir,'media',file),media);
  save();
  return {dir,db,media,key,file,manifest,save,rel:relative(process.cwd(),dir)};
}
test('a complete private family archive verifies without contacting Cloudflare',()=>{
  const f=fixture();
  try{
    const result=check(f.rel);
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/"verified":true/);
    assert.match(result.stdout,/"media":1/);
  }finally{rmSync(f.dir,{recursive:true,force:true})}
});
test('backup checksum detects D1 corruption and missing or modified R2 bytes',()=>{
  const f=fixture();
  try{
    writeFileSync(join(f.dir,'database.sql'),Buffer.from('corrupt'));
    assert.notEqual(check(f.rel).status,0,'a modified SQL backup must fail');
    writeFileSync(join(f.dir,'database.sql'),f.db);
    writeFileSync(join(f.dir,'media',f.file),Buffer.from([1,2,3,4,5,7]));
    assert.notEqual(check(f.rel).status,0,'tampered media must fail');
    rmSync(join(f.dir,'media',f.file));
    assert.notEqual(check(f.rel).status,0,'missing media must fail');
  }finally{rmSync(f.dir,{recursive:true,force:true})}
});
test('backup verifier rejects duplicate object keys, unsafe file names and schema changes',()=>{
  const f=fixture();
  try{
    f.manifest.objects.push({...f.manifest.objects[0]});f.save();
    assert.notEqual(check(f.rel).status,0,'duplicate R2 keys must fail');
    f.manifest.objects.pop();
    f.manifest.objects[0].file='../outside.bin';f.save();
    assert.notEqual(check(f.rel).status,0,'path substitution must fail');
    f.manifest.objects[0].file=f.file;
    f.manifest.schema='unknown-future-format';f.save();
    assert.notEqual(check(f.rel).status,0,'unsupported backup schema must fail');
  }finally{rmSync(f.dir,{recursive:true,force:true})}
});
test('backup CLI refuses verification outside its dedicated private directory',()=>{
  const result=check('README.md');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/backup_path_must_be_inside_/);
});
