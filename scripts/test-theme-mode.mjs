// Light/Dark/System mode picks between the chosen light and dark themes; System
// follows the emulated OS scheme live and without a flash on load.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.SCOTTY_TEST_URL;
assert.ok(base,'Set SCOTTY_TEST_URL to an isolated development server');
const browser=await chromium.launch();

async function openPage(seed){
 const context=await browser.newContext({colorScheme:'dark'});
 const page=await context.newPage();
 page.setDefaultTimeout(8000);
 const errors=[];
 page.on('console',msg=>{if(msg.type()==='error') errors.push(msg.text());});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(seed=>{
  if(!localStorage.getItem('theme-mode-test-seeded')) {
   localStorage.setItem('bmus.theme.demo',seed);
   localStorage.setItem('theme-mode-test-seeded','true');
  }
  // The theme when <body> starts parsing (before first paint), then every value
  // <html> takes, to catch a flash of the wrong theme.
  window.themeLog=[];
  new MutationObserver(()=>{
   const d=document.documentElement, v=`${d?.dataset.theme}/${d?.classList.contains('dark')}`;
   if(document.body && !window.themeLog.length) window.themeLog.push(v);
   else if(window.themeLog.length && window.themeLog.at(-1)!==v) window.themeLog.push(v);
  }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-theme','class']});
 },seed);
 const applied=()=>page.evaluate(()=>`${document.documentElement.dataset.theme}/${document.documentElement.classList.contains('dark')}`);
 return {
  page, errors, applied,
  toggle:()=>page.getByTitle('Toggle theme',{exact:true}).filter({visible:true}),
  waitApplied:v=>page.waitForFunction(v=>`${document.documentElement.dataset.theme}/${document.documentElement.classList.contains('dark')}`===v,v),
  stored:()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bmus.theme.demo'))),
  noFlash:async(v,msg)=>assert.deepEqual([...new Set(await page.evaluate(()=>window.themeLog))],[v],msg),
  stays:async(v,msg)=>{await page.waitForTimeout(200); assert.equal(await applied(),v,msg);},
 };
}

try {
 {
  const t=await openPage(JSON.stringify({mode:'system',light:'light',dark:'nord'}));
  const {page}=t;
  await page.goto(`${base}/p/demo?view=epics`);
  await t.toggle().waitFor();
  await t.waitApplied('nord/true');
  await t.noFlash('nord/true','System under a dark OS shows the dark theme from first paint');

  await page.emulateMedia({colorScheme:'light'});
  await t.waitApplied('light/false');
  await page.emulateMedia({colorScheme:'dark'});
  await t.waitApplied('nord/true');

  // The toggle and T cycle the mode Light -> Dark -> System, keeping both themes.
  await t.toggle().click();
  await t.waitApplied('light/false');
  assert.deepEqual(await t.stored(),{mode:'light',light:'light',dark:'nord'});
  await t.stays('light/false','Light ignores a dark OS');

  await page.keyboard.press('t');
  await t.waitApplied('nord/true');
  assert.equal((await t.stored()).mode,'dark','T shortcut advances the cycle');
  await page.emulateMedia({colorScheme:'light'});
  await t.stays('nord/true','Dark ignores a light OS');

  await t.toggle().click();
  await t.waitApplied('light/false');
  assert.equal((await t.stored()).mode,'system');
  await page.emulateMedia({colorScheme:'dark'});
  await t.waitApplied('nord/true');

  await page.reload();
  await t.toggle().waitFor();
  await t.waitApplied('nord/true');
  await t.noFlash('nord/true','reload keeps System without a flash');

  // Settings: a mode switch plus one picker per mode. In System mode, picking a
  // dark theme under a dark OS shows it at once.
  await page.goto(`${base}/p/demo?view=settings`);
  const modeButton=name=>page.getByRole('group',{name:'Theme mode'}).getByRole('button',{name,exact:true});
  await modeButton('System').waitFor();
  assert.equal(await modeButton('System').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Dracula',exact:true}).click();
  await t.waitApplied('dracula/true');
  assert.deepEqual(await t.stored(),{mode:'system',light:'light',dark:'dracula'});
  await modeButton('Light').click();
  await t.waitApplied('light/false');
  assert.equal(await modeButton('Light').getAttribute('aria-pressed'),'true');
  // In a fixed mode, picking a theme of the other mode switches to it.
  await page.getByRole('button',{name:'Tokyo Night',exact:true}).click();
  await t.waitApplied('tokyo-night/true');
  assert.deepEqual(await t.stored(),{mode:'dark',light:'light',dark:'tokyo-night'});
  assert.deepEqual(t.errors,[]);
 }
 {
  // A bare theme id saved before modes existed becomes that mode and its theme.
  const t=await openPage('gruvbox-dark');
  await t.page.goto(`${base}/p/demo?view=epics`);
  await t.toggle().waitFor();
  await t.waitApplied('gruvbox-dark/true');
  await t.noFlash('gruvbox-dark/true','legacy dark theme applies before first paint');
  await t.toggle().click();
  assert.deepEqual(await t.stored(),{mode:'system',light:'light',dark:'gruvbox-dark'});
  assert.deepEqual(t.errors,[]);
 }
 console.log('PASS: mode picks the chosen light or dark theme; System follows the OS live without a flash; toggle and T cycle Light -> Dark -> System; settings pickers and legacy values work');
} finally { await browser.close(); }
