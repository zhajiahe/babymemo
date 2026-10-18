import assert from 'node:assert/strict';
import {join} from 'node:path';

// Runs with both Chromium and WebKit, against the real Worker-backed UI.
export async function browserThemeRegression({page,context,base,evidence}) {
 const group=page.getByRole('group',{name:'外观主题'});
 const choose=name=>group.getByRole('button',{name,exact:true});
 const effective=()=>page.evaluate(()=>document.documentElement.dataset.theme);
 const colors=()=>page.evaluate(()=>{
  const card=document.querySelector('.settings-grid>.card');
  const input=document.querySelector('.field input');
  const root=document.documentElement;
  return {
   page:getComputedStyle(root).getPropertyValue('--bm-page').trim(),
   ink:getComputedStyle(root).getPropertyValue('--bm-ink').trim(),
   surface:getComputedStyle(card).backgroundColor,
   input:getComputedStyle(input).backgroundColor,
   scheme:getComputedStyle(root).colorScheme,
   meta:document.querySelector('meta[name="theme-color"]')?.content
  };
 });

 await choose('深色').click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 let dark=await colors();
 assert.equal(dark.page.toUpperCase(),'#101820');
 assert.equal(dark.meta,'#101820');
 assert.match(dark.scheme,/dark/);
 assert.notEqual(dark.input,'rgb(255, 255, 255)','form inputs must not stay white');
 await page.screenshot({path:join(evidence,'theme-dark-settings-desktop.png'),fullPage:true});

 await page.reload();
 assert.equal(await effective(),'dark','explicit dark preference persists across reload');
 assert.equal(await page.getByRole('group',{name:'外观主题'}).getByRole('button',{name:'深色'}).getAttribute('aria-pressed'),'true');

 // Test the narrowest supported mobile viewport while the real settings form is visible.
 await page.setViewportSize({width:320,height:700});
 await page.waitForFunction(()=>document.querySelector('.mobile-nav')&&getComputedStyle(document.querySelector('.mobile-nav')).display!=='none');
 // On phones the settings navigation is a list; enter the profile detail
 // before measuring theme controls and native date fields.
 await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/宝宝与外观/}).click();
 const overflow=await page.evaluate(()=>{
  const el=document.querySelector('.theme-switch');
  const rect=el.getBoundingClientRect();
  return rect.left < -1 || rect.right > innerWidth+1;
 });
 assert.equal(overflow,false,'theme segmented switch overflows 320px');
 await page.screenshot({path:join(evidence,'theme-dark-settings-320.png'),fullPage:true});
 const narrowDate=await page.locator('.settings-grid input[type="date"]').first().evaluate(input=>{
  const r=input.getBoundingClientRect(),row=input.closest('.two').getBoundingClientRect();
  return {width:r.width,row:row.width};
 });
 assert.ok(narrowDate.width>230,'320px: date control needs its own row for native calendar affordances');
 // Observe the actual signed-in app, not a static concept or simulated image.
 await page.setViewportSize({width:390,height:844});
 const mobileNav=page.locator('.mobile-nav');
 await mobileNav.getByRole('button',{name:'首页'}).click();
 await page.getByRole('heading',{name:'Test Baby'}).waitFor();
 await page.screenshot({path:join(evidence,'theme-dark-mobile-home-390.png'),fullPage:false});
 await mobileNav.getByRole('button',{name:'相册'}).click();
 await page.locator('.photo-preview').first().waitFor();
 await page.screenshot({path:join(evidence,'theme-dark-mobile-album-390.png'),fullPage:false});
 await page.locator('.photo-preview').first().click();
 const liveViewer=page.getByRole('dialog',{name:'相册预览'});
 await liveViewer.waitFor();
 await page.screenshot({path:join(evidence,'theme-dark-mobile-media-viewer-390.png'),fullPage:false});
 await liveViewer.getByRole('button',{name:'关闭预览'}).click();
 await mobileNav.getByRole('button',{name:'成长'}).click();
 await page.getByRole('heading',{name:'成长记录'}).waitFor();
 await page.screenshot({path:join(evidence,'theme-dark-mobile-growth-390.png'),fullPage:false});
 await page.getByRole('button',{name:'新增成长记录'}).click();
 const growthModal=page.getByRole('dialog',{name:'新增成长记录'});
 await growthModal.waitFor();
 await page.screenshot({path:join(evidence,'theme-dark-mobile-growth-modal-390.png'),fullPage:false});
 await growthModal.getByRole('button',{name:'关闭新增成长记录'}).click();
 await mobileNav.getByRole('button',{name:'设置'}).click();
 await page.getByRole('group',{name:'外观主题'}).waitFor();
 await page.setViewportSize({width:1280,height:900});

 // The public demo must share the saved appearance but never need authentication.
 const demo=await context.newPage();
 try {
  await demo.goto(base+'/demo.html',{waitUntil:'domcontentloaded'});
  await demo.locator('.demo-app').waitFor();
  assert.equal(await demo.evaluate(()=>document.documentElement.dataset.theme),'dark');
  await demo.locator('.sidebar .nav-link').filter({hasText:'相册'}).click();
  await demo.locator('.photo-preview').first().click();
  await demo.getByRole('dialog',{name:'照片故事'}).waitFor();
  assert.equal(await demo.locator('.media-viewer-stage img').first().evaluate(el=>getComputedStyle(el).filter),'none','media imagery must remain unfiltered');
  await demo.screenshot({path:join(evidence,'theme-dark-demo-viewer.png'),fullPage:true});
  await demo.getByRole('dialog',{name:'照片故事'}).getByRole('button',{name:'关闭照片详情'}).click();
  await demo.locator('.sidebar .nav-link').filter({hasText:'设置'}).click();
  await demo.getByRole('group',{name:'外观主题'}).getByRole('button',{name:'浅色'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  assert.equal((await colors()).meta,'#F8F8F6','change in the other tab updates browser chrome');
 } finally {await demo.close()}

 // The desktop phone preview's actual iframe follows the outer document.
 const mobile=await context.newPage();
 try {
  await mobile.goto(base+'/demo/mobile.html',{waitUntil:'domcontentloaded'});
  await mobile.locator('iframe').waitFor();
  await mobile.locator('.mobile-demo-header .theme-switch button').filter({hasText:'深色'}).click();
  await mobile.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await mobile.frameLocator('iframe').locator('html[data-theme="dark"]').waitFor();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 } finally {await mobile.close()}

 // No saved appearance: mobile defaults to the device OS, including after reload.
 await page.setViewportSize({width:390,height:844});
 await choose('跟随系统').click();
 await page.emulateMedia({colorScheme:'dark'});
 await page.reload();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 assert.equal(await page.evaluate(()=>localStorage.getItem('babymemo-theme')),null);
 assert.equal(await page.getByRole('group',{name:'外观主题'}).getByRole('button',{name:'跟随系统'}).getAttribute('aria-pressed'),'true');
 await page.screenshot({path:join(evidence,'theme-system-mobile-dark-390.png'),fullPage:false});
 await page.setViewportSize({width:1280,height:900});
 await page.emulateMedia({colorScheme:'light'});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await choose('深色').click();
 await page.emulateMedia({colorScheme:'light'});
 assert.equal(await effective(),'dark','manual choice overrides system appearance');
 await choose('跟随系统').click();
 await page.emulateMedia({colorScheme:null});
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 assert.equal(await page.evaluate(()=>localStorage.getItem('babymemo-theme')),null,'system mode clears override');
}
