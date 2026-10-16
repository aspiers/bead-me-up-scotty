// System theme follows the emulated OS scheme live; Light and Dark ignore it.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.SCOTTY_TEST_URL;
assert.ok(base,'Set SCOTTY_TEST_URL to an isolated development server');
const browser=await chromium.launch();
try {
 const context=await browser.newContext({colorScheme:'dark'});
 const page=await context.newPage();
 page.setDefaultTimeout(8000);
 const errors=[];
 page.on('console',msg=>{if(msg.type()==='error') errors.push(msg.text());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  if(!localStorage.getItem('system-theme-test-seeded')) {
   localStorage.setItem('bmus.theme.demo','system');
   localStorage.setItem('system-theme-test-seeded','true');
  }
  // The theme when <body> starts parsing (before first paint), then every value
  // <html> takes, to catch a flash of the wrong theme.
  window.themeLog=[];
  new MutationObserver(()=>{
   const d=document.documentElement, v=`${d?.dataset.theme}/${d?.classList.contains('dark')}`;
   if(document.body && !window.themeLog.length) window.themeLog.push(v);
   else if(window.themeLog.length && window.themeLog.at(-1)!==v) window.themeLog.push(v);
  }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-theme','class']});
 });
 const toggle=page.getByTitle('Toggle theme',{exact:true});
 const applied=()=>page.evaluate(()=>`${document.documentElement.dataset.theme}/${document.documentElement.classList.contains('dark')}`);
 const waitApplied=v=>page.waitForFunction(v=>`${document.documentElement.dataset.theme}/${document.documentElement.classList.contains('dark')}`===v,v);
 const stored=()=>page.evaluate(()=>localStorage.getItem('bmus.theme.demo'));

 await page.goto(`${base}/p/demo?view=epics`);
 await toggle.waitFor();
 await waitApplied('dark/true');
 const log=await page.evaluate(()=>window.themeLog);
 assert.ok(log.length>0,'theme must be applied');
 assert.deepEqual([...new Set(log)],['dark/true'],`System under a dark OS must never show light: ${log}`);

 await page.emulateMedia({colorScheme:'light'});
 await waitApplied('light/false');
 await page.emulateMedia({colorScheme:'dark'});
 await waitApplied('dark/true');

 // Cycle Light -> Dark -> System from System.
 await toggle.click();
 await waitApplied('light/false');
 assert.equal(await stored(),'light');
 await page.emulateMedia({colorScheme:'dark'});
 await page.waitForTimeout(200);
 assert.equal(await applied(),'light/false','Light ignores a dark OS');

 await page.keyboard.press('t');
 await waitApplied('dark/true');
 assert.equal(await stored(),'dark','T shortcut advances the cycle');
 await page.emulateMedia({colorScheme:'light'});
 await page.waitForTimeout(200);
 assert.equal(await applied(),'dark/true','Dark ignores a light OS');

 await toggle.click();
 await waitApplied('light/false');
 assert.equal(await stored(),'system');
 await page.emulateMedia({colorScheme:'dark'});
 await waitApplied('dark/true');

 await page.reload();
 await toggle.waitFor();
 await waitApplied('dark/true');
 assert.deepEqual([...new Set(await page.evaluate(()=>window.themeLog))],['dark/true'],'reload keeps System without a flash');
 assert.deepEqual(errors,[]);
 console.log('PASS: System follows the OS scheme live without a flash; Light and Dark ignore it; toggle and T cycle Light -> Dark -> System');
} finally { await browser.close(); }
