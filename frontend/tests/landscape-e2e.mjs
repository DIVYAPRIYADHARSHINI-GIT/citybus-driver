import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
const port=4186,base=`http://127.0.0.1:${port}`,delay=ms=>new Promise(r=>setTimeout(r,ms));
// Own a separate static preview so offline means the serving process is actually
// stopped. Page-level network emulation alone may not isolate SW fetches.
const probe=createServer();await new Promise((resolve,reject)=>probe.once('error',reject).listen(port,'127.0.0.1',resolve));await new Promise(r=>probe.close(r));
let server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'}),browser,page;
async function stopServer(){if(!server)return;const child=server;server=null;if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});}
const errors=[],screens=[];let checks=0,offline=false;
const check=(v,s)=>{assert.ok(v,s);console.log(`PASS ${++checks}: ${s}`);};
try{
 for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Owned preview failed to start');try{if((await fetch(base)).ok)break;}catch{}await delay(100);}
 browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist']});
 page=await browser.newPage();const click=s=>page.locator(s).setTimeout(15000).click();
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!(offline&&/net::ERR_(CONNECTION_REFUSED|FAILED|INTERNET_DISCONNECTED)/.test(m.text())))errors.push(m.text());});
 await mkdir('test-results/stage6/landscape',{recursive:true});
 for(const [width,height] of [[844,390],[915,412],[667,375]]){
  await page.setViewport({width,height,isMobile:true,hasTouch:true,deviceScaleFactor:1});await page.goto(base,{waitUntil:'networkidle0'});
  if(width===667){await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);offline=true;await stopServer();await page.reload({waitUntil:'networkidle0'});check(await page.evaluate(async()=>{try{await fetch('/__uncached_offline_probe__?'+Date.now(),{cache:'no-store'});return false;}catch{return true;}}),'serving process stopped: uncached fetch fails but the installed game reloads');}
  await click('#city-launch');await page.select('#world-select','meridian');await click('[data-route="M1"]');await page.waitForFunction(()=>window.citybus.city()?.chunks>0);
  const controls=await page.$$eval('[data-hold]',buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {hold:b.dataset.hold,w:r.width,h:r.height,reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b};}));
  check(controls.length===4&&controls.every(c=>c.w>=44&&c.h>=44&&c.reachable),`${width}×${height}: four thumb controls visible, large enough and unobstructed`);
  await click('#controls-toggle');await click('[data-action="ignition"]');await click('[data-action="parking"]');await click('[data-action="gearUp"]');await click('#controls-toggle');
  const cdp=await page.createCDPSession(),point=async selector=>page.$eval(selector,e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  const pedal=await point('[data-hold="throttle:1"]');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pedal,id:1}]});await page.waitForFunction(()=>window.citybus.snapshot().speed>.8,{timeout:15000});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(150);
  check(await page.evaluate(()=>window.citybus.snapshot().speed>.5&&window.citybus.snapshot().throttle===0),`${width}: actual touch accelerates and release clears the pedal`);
  const brake=await point('[data-hold="brake:1"]');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...brake,id:2}]});await page.waitForFunction(()=>Math.abs(window.citybus.snapshot().speed)<.1);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no horizontal overflow`);await delay(300);await page.screenshot({path:`test-results/stage6/landscape/${width}.png`});screens.push({width,height,offline,controls});await cdp.detach();
 }
 check(!errors.length,`no unexpected application/WebGL errors: ${errors.join(';')}`);await writeFile('test-results/stage6/landscape/report.json',JSON.stringify({checks,screens,errors,device:'Desktop Chrome touch emulation; not Android hardware',offlineMethod:'Owned preview process terminated before cached reload and real touch drive',finished:new Date().toISOString()},null,2));
}catch(e){console.error(e,errors);if(page){console.error(await page.evaluate(()=>({game:!!window.citybus,loading:document.getElementById('loading')?.className,body:document.body.innerText.slice(0,600),launch:document.getElementById('city-launch')?.getBoundingClientRect().toJSON()})));await page.screenshot({path:'test-results/stage6/landscape/failure.png'}).catch(()=>{});}process.exitCode=1;}finally{await browser?.close();await stopServer();}
