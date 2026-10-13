import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {streamZip,textEntry} from '../src/stream-zip.mjs';
test('standard ZIP reader validates streamed ZIP64 contents and CRC32',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'babymemo-zip-'));
 try{
  const bytes=Uint8Array.from({length:10000},(_,i)=>i%251),chunks=[bytes.slice(0,2000),bytes.slice(2000,7000),bytes.slice(7000)];
  const archive=streamZip([textEntry('records.json','{"birthday":"2025-01-01","birth_time":"12:34"}'),{name:'media/synthetic/original.bin',size:bytes.length,open:async()=>new ReadableStream({pull(controller){const next=chunks.shift();if(next)controller.enqueue(next);else controller.close()}})}]);
  writeFileSync(join(directory,'archive.zip'),Buffer.from(await new Response(archive).arrayBuffer()));
  const check=spawnSync('python3',['-c',"import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert json.loads(z.read('records.json'))['birth_time']=='12:34'; assert z.read('media/synthetic/original.bin')==bytes(i%251 for i in range(10000)); print('ZIP64_OK')",join(directory,'archive.zip')],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/ZIP64_OK/);
 }finally{rmSync(directory,{recursive:true,force:true})}
});
test('missing original bytes abort the archive instead of claiming a complete export',async()=>{
 const archive=streamZip([{name:'media/short.bin',size:20,open:async()=>new Blob(['short']).stream()}]);
 await assert.rejects(new Response(archive).arrayBuffer(),/MISSING_BYTES/);
});
test('ZIP consumers receive headers before any original is buffered',async()=>{
 let opened=false;
 const stream=streamZip([{name:'media/test.bin',size:1,open:async()=>{opened=true;return new Blob(['x']).stream()}}]);
 const reader=stream.getReader();await reader.read();assert.equal(opened,false);await reader.cancel();
});
