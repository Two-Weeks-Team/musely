// Offline synthetic normal HTML box, not a CAPTCHA or authentication test.
// PLAYWRIGHT_MODULE points to an already-installed playwright-core entry point.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const module=await import(process.env.PLAYWRIGHT_MODULE),{chromium}=module.default??module;
const css=await readFile(new URL('../src/style.css',import.meta.url),'utf8');
const code=(await build({entryPoints:[new URL('../src/live.ts',import.meta.url).pathname],bundle:true,platform:'browser',format:'iife',globalName:'SessionFixture',write:false,plugins:[{name:'offline',setup(b){b.onResolve({filter:/^\.\/ui\/(isolation|resource-state)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('isolation')?'export const isolation={replay:false};':'export const BLOCKED="blocked";'}));}}]})).outputFiles[0].text;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-networking']});
let networkAttempts=0;
try{
 const context=await browser.newContext();await context.route('**/*',r=>{networkAttempts++;return r.abort();});
 for(const viewport of[{width:390,height:844},{width:1440,height:900}]){
  const page=await context.newPage();await page.setViewportSize(viewport);
  await page.setContent('<style>'+css+'</style><section class="world-panel" id="world-panel" popover="manual"><h2>Normal underlying HTML panel</h2><div style="height:900px">Synthetic content</div></section>');
  await page.addScriptTag({content:code});
  await page.evaluate(()=>{
   document.querySelector('#world-panel').showPopover();
   globalThis.synthetic={posts:0,removed:0,outcome:null};
   const append=document.head.append.bind(document.head);
   document.head.append=(...nodes)=>{for(const n of nodes){if(n.tagName==='SCRIPT'&&n.src==='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')queueMicrotask(()=>n.onload());else append(n);}};
   window.turnstile={render(host){const box=document.createElement('button');box.id='synthetic-box';box.textContent='NORMAL HTML BOX';box.style.cssText='width:300px;height:65px;background:white;color:black';host.append(box);return 'synthetic';},remove(){synthetic.removed++;}};
   window.fetch=async()=>{synthetic.posts++;throw Error('Offline fixture forbids network');};
   void SessionFixture.ensureSession({session:null,turnstile:{sitekey:'synthetic-public-sitekey',configured:true}}).then(()=>synthetic.outcome='unexpected-success',()=>synthetic.outcome='cancelled');
  });
  await page.waitForSelector('#synthetic-box');
  const hit=await page.evaluate(()=>{const box=document.querySelector('#synthetic-box'),r=box.getBoundingClientRect();return{bounds:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.id,worldPanelOpen:document.querySelector('#world-panel').matches(':popover-open'),verificationOpen:document.querySelector('.session-verification').matches(':popover-open')};});
  assert.equal(hit.hit,'synthetic-box');assert.equal(hit.worldPanelOpen,true);assert.equal(hit.verificationOpen,true);
  await page.locator('[data-action="cancel-verification"]').click();
  const result=await page.evaluate(()=>({...synthetic,cardRemoved:!document.querySelector('.session-verification')}));
  assert.deepEqual(result,{posts:0,removed:1,outcome:'cancelled',cardRemoved:true});
  console.log(JSON.stringify({viewport,...hit,...result}));await page.close();
 }
 await context.close();assert.equal(networkAttempts,0);
}finally{await browser.close();console.log(JSON.stringify({networkAttempts,ownedBrowserClosed:true,classification:'offline-synthetic-normal-HTML-only'}));}
