import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mediaThumbnailUrl,thumbnailVersion,cacheableThumbnail,MAX_AUTO_THUMBNAILS,MAX_AUTO_THUMBNAIL_BYTES} from '../src/private-media-cache.mjs';
import {mediaReadTiming} from '../src/media-timing.mjs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const worker=read('src/worker.ts'),sw=read('src/service-worker.ts'),offline=read('src/offline.ts');
const viewer=read('src/components/MediaViewer.tsx'),album=read('src/features/album/Album.tsx');

test('thumbnail URLs are stable within a revision and change after new covers',()=>{
 const item={id:'baby-media',updated_at:'version-1'};
 const url=mediaThumbnailUrl(item);
 assert.equal(url,'/api/media/baby-media/thumbnail?v=version-1');
 assert.equal(thumbnailVersion(url),'version-1');
 assert.notEqual(mediaThumbnailUrl({...item,updated_at:'version-2'}),url);
 assert.equal(mediaThumbnailUrl({id:'legacy'}),'/api/media/legacy/thumbnail');
 assert.equal(thumbnailVersion('/api/media/baby-media/thumbnail?download=1'),null);
 assert.equal(thumbnailVersion('/api/media/baby-media/thumbnail?v=x&download=1'),null);
 assert.equal(thumbnailVersion('/api/media/baby-media/content?v=x'),null);
 assert.match(mediaThumbnailUrl({id:'a/b',updated_at:'x&y'}),/a%2Fb\/thumbnail\?v=x%26y$/);
});

test('only version-matched small, authenticated private JPEG derivatives can auto-cache',()=>{
 const url='/api/media/id/thumbnail?v=rev1';
 const headers={'Content-Type':'image/jpeg','Content-Length':'32256','X-Thumbnail-Version':'rev1','X-Thumbnail-Derivative':'1'};
 const response=(status=200,other={})=>new Response(status===304?null:'fake-bytes',{status,headers:{...headers,...other}});
 assert.equal(cacheableThumbnail(url,response()),true);
 assert.equal(cacheableThumbnail('/api/media/id/content?v=rev1',response()),false);
 assert.equal(cacheableThumbnail('/api/media/id/thumbnail',response()),false);
 assert.equal(cacheableThumbnail(url,response(304)),false);
 assert.equal(cacheableThumbnail(url,response(200,{'X-Thumbnail-Version':'different'})),false);
 assert.equal(cacheableThumbnail(url,response(200,{'X-Thumbnail-Derivative':'0'})),false);
 assert.equal(cacheableThumbnail(url,response(200,{'Content-Length':String(MAX_AUTO_THUMBNAIL_BYTES+1)})),false);
 assert.equal(cacheableThumbnail(url,response(200,{'Content-Type':'video/mp4'})),false);
 assert.equal(MAX_AUTO_THUMBNAILS,160);
 assert.equal(MAX_AUTO_THUMBNAIL_BYTES,128*1024);
});

test('session-gated thumbnail cache cannot silently retain originals or survive logout',()=>{
 assert.match(sw,/if\(deviceSession\?\.value\.unlocked===false\)return new Response\(null,\{status:401\}\)/);
 assert.match(sw,/if\(cached\)return cached/);
 assert.match(sw,/cacheableThumbnail\(request\.url,response\)/);
 assert.match(sw,/keys\.slice\(0,Math\.max\(0,keys\.length-MAX_AUTO_THUMBNAILS\)\)/);
 assert.doesNotMatch(sw,/25\*1024\*1024/);
 assert.match(sw,/fetch\(request,\{cache:'no-store'\}\)/);
 assert.match(sw,/Promise\.all\(\[caches\.delete\(PRIVATE_MEDIA_CACHE\),caches\.delete\(PRIVATE_THUMBNAIL_CACHE\)\]\)/);
 assert.match(offline,/await Promise\.all\(\[caches\.delete\(PRIVATE_MEDIA_CACHE\),caches\.delete\(PRIVATE_THUMBNAIL_CACHE\)\]\)/);
 assert.match(offline,/await \(await caches\.open\(PRIVATE_MEDIA_CACHE\)\)\.put\(path,response\)/);
 assert.match(worker,/Cache-Control':'private, no-store'/);
 assert.match(worker,/X-Thumbnail-Version/);
 assert.match(worker,/updated_at=\? WHERE id=\?/);
});

test('progressive gallery keeps one original image and limits preloading to small posters',()=>{
 assert.match(viewer,/className="media-poster-preview"/);
 assert.match(viewer,/preload="metadata" poster=\{mediaThumbnailUrl\(item\)\}/);
 assert.match(viewer,/currentImageStatus!=='ready'/);
 assert.match(viewer,/neighbors\.filter\(neighbor=>neighbor\.id!==item\.id\)\.slice\(0,2\)/);
 assert.match(viewer,/connection\?\.saveData/);
 assert.doesNotMatch(viewer,/prefetchOriginal|new Video\(/);
 assert.match(album,/neighbors=\{selectedIndex<0\?\[\]:/);
});

test('read telemetry only emits timing buckets and does not disclose media identity',()=>{
 let json;
 const event=mediaReadTiming({kind:'thumbnail',status:304,size:32123,d1Ms:6.4,r2Ms:501.9,totalMs:509.3,emit:line=>{json=line}});
 assert.equal(event.event,'MEDIA_READ_TIMING');
 assert.equal(event.status,304);
 assert.equal(event.d1Ms,6);
 assert.equal(event.r2Ms,502);
 assert.equal(event.totalMs,509);
 assert.equal(event.sizeBand,'<=1MiB');
 assert.deepEqual(Object.keys(JSON.parse(json)).sort(),['d1Ms','event','kind','level','r2Ms','sizeBand','status','totalMs'].sort());
 assert.match(worker,/mediaReadTiming\(\{kind:'thumbnail'/);
 assert.match(worker,/mediaReadTiming\(\{kind:'original'/);
});
