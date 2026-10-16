import assert from 'node:assert/strict';
import test from 'node:test';
import {jpegCaptureDay,jpegXmpCaptureDay,photoCaptureDay,bestEffortFileDay,r2PhotoCaptureDay} from '../src/media-date.mjs';
import {exifJpeg,exifHeic,exifWebp,exifPng} from './fixtures/media-exif.mjs';

test('valid JPEG EXIF original date wins over modification metadata',()=>{
  const bytes=new Uint8Array(76);
  const v=new DataView(bytes.buffer);bytes.set([255,216,255,225],0);v.setUint16(4,72,false);
  bytes.set([69,120,105,102,0,0],6);const b=12;
  bytes.set([73,73],b);v.setUint16(b+2,42,true);v.setUint32(b+4,8,true);
  v.setUint16(b+8,1,true);
  v.setUint16(b+10,0x8769,true);v.setUint16(b+12,4,true);v.setUint32(b+14,1,true);v.setUint32(b+18,26,true);
  v.setUint16(b+26,1,true);
  v.setUint16(b+28,0x9003,true);v.setUint16(b+30,2,true);v.setUint32(b+32,20,true);v.setUint32(b+36,44,true);
  bytes.set(new TextEncoder().encode('2026:09:03 12:34:56\0'),b+44);
  assert.equal(jpegCaptureDay(bytes),'2026-09-03');
  bytes[b+44]=88;
  assert.equal(jpegCaptureDay(bytes),null);
  assert.equal(jpegCaptureDay(new Uint8Array([1,2,3])),null);
});
test('JPEG, HEIC and WebP preserve the camera calendar day instead of a download modification date',async()=>{
 for(const [bytes,mime,name] of [[exifJpeg(),'image/jpeg','photo.jpg'],[exifHeic(),'image/heic','photo.heic'],[exifPng(),'image/png','photo.png'],[exifWebp(),'image/webp','photo.webp']]){
  const file=new File([bytes],name,{type:mime,lastModified:Date.now()});assert.equal(await bestEffortFileDay(file,'2026-10-13'),'2020-09-03');
 }
});
test('WebP metadata after a large pixel chunk is read without loading that chunk',async()=>{
 const bytes=exifWebp(undefined,524288),ranges=[];const bucket={get:async(_key,{range})=>{ranges.push(range);return {arrayBuffer:async()=>bytes.slice(range.offset,range.offset+range.length).buffer}}};
 assert.equal(await bestEffortFileDay(new File([bytes],'tail.webp',{type:'image/webp'}),'2026-10-13'),'2020-09-03');
 assert.equal(await r2PhotoCaptureDay(bucket,'private/tail',bytes.length,'image/webp'),'2020-09-03');assert.ok(ranges.some(x=>x.offset>262144));assert.ok(ranges.reduce((n,x)=>n+x.length,0)<=1048576);
});
test('a missing, corrupt, impossible or future capture date uses the selected fallback, never lastModified',async()=>{
 for(const bytes of [new Uint8Array([1,2,3]),exifJpeg('2020:02:30 12:34:56'),exifJpeg('2999:09:03 12:34:56')]){
  const file=new File([bytes],'photo.jpg',{type:'image/jpeg',lastModified:Date.now()});assert.equal(await bestEffortFileDay(file,'2019-01-01'),'2019-01-01');
 }
 assert.equal(await photoCaptureDay(exifJpeg()),'2020-09-03');
});

function xmpJpeg(xml){
 const body=new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\\0'.replace('\\0',String.fromCharCode(0))+xml);
 const bytes=new Uint8Array(2+4+body.length+2),view=new DataView(bytes.buffer);
 bytes.set([255,216,255,225]);view.setUint16(4,body.length+2,false);
 bytes.set(body,6);bytes.set([255,217],6+body.length);
 return bytes;
}
test('ordinary JPEG recovers the XMP camera date if its EXIF TIFF block was stripped',async()=>{
 const bytes=xmpJpeg('<x:xmpmeta><rdf:Description exif:DateTimeOriginal="2020-09-03T08:14:23+08:00" xmp:ModifyDate="2026-10-15T01:00:00Z"/></x:xmpmeta>');
 assert.equal(jpegCaptureDay(bytes),null);
 assert.equal(jpegXmpCaptureDay(bytes),'2020-09-03');
 assert.equal(await photoCaptureDay(bytes),'2020-09-03');
 const ranges=[],bucket={get:async(_key,{range})=>{ranges.push(range);return {arrayBuffer:async()=>bytes.slice(range.offset,range.offset+range.length).buffer}}};
 assert.equal(await r2PhotoCaptureDay(bucket,'private/example',bytes.length,'image/jpeg'),'2020-09-03');
 assert.ok(ranges.reduce((n,x)=>n+x.length,0)<=1048576);
});
test('XMP Photoshop creation date and XML element date work when camera EXIF is absent',async()=>{
 const ps=xmpJpeg('<rdf:Description photoshop:DateCreated="2019-06-02" xmp:ModifyDate="2026-10-15"/>');
 assert.equal(jpegXmpCaptureDay(ps),'2019-06-02');
 const exif=xmpJpeg('<exif:DateTimeOriginal>2020:01:03 10:25:00</exif:DateTimeOriginal>');
 assert.equal(await photoCaptureDay(exif),'2020-01-03');
});
test('never invent a camera date from pixels, modification timestamps, conflicting XMP, or future dates',async()=>{
 const forged=xmpJpeg('<rdf:Description xmp:ModifyDate="2020-01-01" dc:description="taken 2020-02-03"/>');
 assert.equal(await photoCaptureDay(forged),null);
 const conflict=xmpJpeg('<rdf:Description xmp:CreateDate="2020-09-03" xmp:CreateDate="2022-11-12"/>');
 assert.equal(jpegXmpCaptureDay(conflict),null);
 assert.equal(await photoCaptureDay(xmpJpeg('<rdf:Description xmp:CreateDate="2999-05-02"/>')),null);
 const original=exifJpeg(),withoutEnd=original.subarray(0,original.length-2);
 const later=xmpJpeg('<rdf:Description xmp:CreateDate="2026-01-01"/>');
 const merged=new Uint8Array(withoutEnd.length+later.length-2);
 merged.set(withoutEnd);merged.set(later.subarray(2),withoutEnd.length);
 assert.equal(await photoCaptureDay(merged),'2020-09-03');
});

test('private R2 reads find HEIC metadata beyond the prefix within bounded range I/O',async()=>{
 const bytes=exifHeic(),ranges=[];const bucket={get:async(_key,{range})=>{ranges.push(range);return {arrayBuffer:async()=>bytes.slice(range.offset,range.offset+range.length).buffer}}};
 assert.equal(await r2PhotoCaptureDay(bucket,'private/test',bytes.length,'image/heic'),'2020-09-03');assert.ok(ranges.some(x=>x.offset>262144));assert.ok(ranges.length<=16);assert.ok(ranges.every(x=>x.length<=262144));assert.ok(ranges.reduce((n,x)=>n+x.length,0)<=1048576);
});
