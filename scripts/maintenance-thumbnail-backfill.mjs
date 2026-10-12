#!/usr/bin/env node
// One-off operator utility for old imports. NEVER run automatically or from the product.
// Requires an authenticated family session; only creates JPEG derivatives through
// existing private Worker endpoints. Originals are never overwritten.
const base=process.env.BABYMEMO_URL;
const name=process.env.BABYMEMO_USER;
const password=process.env.BABYMEMO_PASSWORD;
const apply=process.argv.includes('--apply');
const max=Math.min(100,Math.max(1,Number.parseInt(process.env.BABYMEMO_BACKFILL_LIMIT||'20',10)||20));
let cursor=process.env.BABYMEMO_BACKFILL_AFTER||'';
const targetBabyId=process.env.BABYMEMO_BACKFILL_BABY_ID||'';
if(!base||!name||!password)throw Error('Set BABYMEMO_URL, BABYMEMO_USER and BABYMEMO_PASSWORD locally (never in git).');
if(apply&&process.env.BABYMEMO_BACKFILL_CONFIRM!=='YES')throw Error('--apply requires BABYMEMO_BACKFILL_CONFIRM=YES');
const u=new URL(base);
if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash)throw Error('Only a canonical HTTPS root URL is allowed');
const {chromium}=await import('playwright').catch(()=>{throw Error('Install temporary Playwright: npm install --no-save playwright@1.56.1; npx playwright install chromium')});
const browser=await chromium.launch({headless:true});
let scanned=0,completed=0,skipped=0,failed=0,remaining=0;
try{
 const page=await browser.newPage();
 await page.goto(u.origin,{waitUntil:'domcontentloaded'});
 const loggedIn=await page.evaluate(async ({name,password})=>{
  const res=await fetch('/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password})});
  return res.ok;
 },{name,password});
 if(!loggedIn)throw Error('Authentication failed; check credentials and rate limits');
 const state=await page.evaluate(async ()=>{const r=await fetch('/api/state');if(!r.ok)throw Error('STATE_'+r.status);return r.json()});
 if(state.babies.length>1&&!targetBabyId)throw Error('Multiple babies: set BABYMEMO_BACKFILL_BABY_ID to avoid ambiguous maintenance cursor');
 if(targetBabyId&&!state.babies.some(b=>b.id===targetBabyId))throw Error('Unknown BABYMEMO_BACKFILL_BABY_ID');
 for(const baby of state.babies){
  if(targetBabyId&&baby.id!==targetBabyId)continue;
  if(scanned>=max)break;
  let after=cursor;
  for(;;){
   if(scanned>=max)break;
   const list=await page.evaluate(async ({id,after})=>{
    const r=await fetch('/api/media/thumbnail-backfill?babyId='+encodeURIComponent(id)+'&after='+encodeURIComponent(after));
    if(!r.ok)throw Error('LIST_'+r.status);
    return r.json();
   },{id:baby.id,after});
   remaining+=list.remaining;
   if(!list.items.length)break;
   for(const item of list.items){
    cursor=item.id;
    after=item.id;
    if(scanned>=max)break;
    scanned++;
    if(!apply){skipped++;continue}
    if(item.size>25*1024*1024){skipped++;continue}
    try{
     const result=await page.evaluate(async ({id})=>{
      const r=await fetch('/api/media/'+encodeURIComponent(id)+'/content');
      if(!r.ok)throw Error('ORIGINAL_'+r.status);
      if(Number(r.headers.get('content-length')||0)>25*1024*1024)return 'skipped';
      const blob=await r.blob();
      if(blob.size>25*1024*1024)return 'skipped';
      const url=URL.createObjectURL(blob);
      try{
       const image=new Image();image.src=url;await image.decode();
       const canvas=document.createElement('canvas');
       const scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
       canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
       canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
       const ctx=canvas.getContext('2d',{alpha:false});
       if(!ctx)return 'skipped';
       ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
       const encode=q=>new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));
       let thumb=await encode(0.76);
       if(thumb&&thumb.size>524288)thumb=await encode(0.52);
       if(!thumb||thumb.size>524288)return 'skipped';
       const put=await fetch('/api/media/'+encodeURIComponent(id)+'/thumbnail',{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:thumb});
       if(!put.ok)throw Error('THUMBNAIL_'+put.status);
       return 'completed';
      }finally{URL.revokeObjectURL(url)}
     },{id:item.id});
     if(result==='completed')completed++;else skipped++;
    }catch{failed++}
   }
   if(scanned>=max)break;
  }
 }
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',scanned,completed,skipped,failed,estimatedRemaining:remaining,nextCursor:cursor,note:'Cursor is scoped to one baby. For multi-baby families supply BABYMEMO_BACKFILL_BABY_ID and resume with BABYMEMO_BACKFILL_AFTER.'},null,2));
}finally{await browser.close()}
