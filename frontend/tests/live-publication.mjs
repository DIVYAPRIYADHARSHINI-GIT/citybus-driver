// Public frontend verification only. No account credentials are entered/stored.
// Render is not provisioned in this run: online flows are reported as blocked,
// never converted into fake passing authentication/cloud/room checks.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const supplied=process.env.LIVE_FRONTEND_URL;
if(!supplied)throw Error('Set LIVE_FRONTEND_URL to the actual verified production URL.');
const origin=new URL(supplied).origin;if(!origin.startsWith('https://'))throw Error('Expected a live HTTPS origin.');
const runId=new Date().toISOString().replace(/[:.]/g,'-'),shots=resolve('../screenshots/live',runId),bugs=resolve('../bugs/live',runId),verification=resolve('../verification');
await Promise.all([mkdir(shots,{recursive:true}),mkdir(bugs,{recursive:true}),mkdir(verification,{recursive:true})]);
const report={origin,runId,verifiedAt:new Date().toISOString(),timezone:'Asia/Kolkata',checks:[],screenshots:[],bugs:[],apiProbes:[],applicationErrors:[],unexpectedConsoleErrors:[],expectedApiErrors:0,online:{login:'blocked: no Render backend deployed',cloudSave:'blocked: no Render backend deployed',multiplayerRoom:'blocked: no Render backend deployed'},status:'running'};
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage();await page.setViewport({width:1440,height:900});let probing=false;
const safe=s=>String(s).replace(/(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,'[credential redacted]');
page.on('pageerror',e=>report.applicationErrors.push(safe(e.message)));
page.on('console',m=>{if(m.type()==='error'){if(probing&&/Failed to load resource/.test(m.text()))report.expectedApiErrors++;else report.unexpectedConsoleErrors.push(safe(m.text()));}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const click=async selector=>{await page.waitForSelector(selector,{visible:true,timeout:20000});await page.click(selector);};
const check=(condition,label)=>{assert.ok(condition,label);report.checks.push({label,passed:true});console.log('PASS:',label);};
const shot=async(name,caption,problem=false)=>{const path=resolve(problem?bugs:shots,name+'.png');await page.screenshot({path});const item={path:`${problem?'bugs':'screenshots'}/live/${runId}/${name}.png`,caption};(problem?report.bugs:report.screenshots).push(item);};
try{
 const response=await page.goto(origin,{waitUntil:'networkidle0',timeout:60000});check(response?.ok(),'production frontend responds successfully');
 await page.waitForFunction(()=>window.citybus?.snapshot().frames>8,{timeout:30000});check(await page.title()==='CityBus Driver — Take the wheel','live main menu and WebGL app load');await shot('main-menu','Live production main menu on the recorded HTTPS origin.');
 await click('#start');await page.keyboard.press('i');await page.keyboard.press('e');await page.keyboard.press('p');const before=await page.evaluate(()=>window.citybus.snapshot().position);
 await page.keyboard.down('w');await page.waitForFunction(()=>window.citybus.snapshot().speed>1.5,{timeout:20000});await page.keyboard.up('w');
 const moving=await page.evaluate(()=>window.citybus.snapshot());check(moving.position[2]<before[2]&&moving.speed>1,'real keyboard accelerator moves the live physics body');await shot('driving-cockpit','Live cockpit after genuine keyboard acceleration; no pose/finish mutator was used.');
 await page.keyboard.down('a');await wait(450);check(await page.evaluate(()=>window.citybus.snapshot().steer>.02),'keyboard steering changes the live steering state');await page.keyboard.up('a');
 await page.keyboard.down('s');await page.waitForFunction(()=>Math.abs(window.citybus.snapshot().speed)<.15,{timeout:20000});await page.keyboard.up('s');check(await page.evaluate(()=>Math.abs(window.citybus.snapshot().speed)<.2),'service brake stops the bus');await page.keyboard.press('c');await wait(250);await shot('driving-exterior','Live exterior view after the physical driving and braking check.');
 await click('#pause');await click('#finish');check(await page.evaluate(()=>JSON.parse(localStorage.getItem('citybus-driver.v1')).sessions.some(s=>s.meters>1)),'completed drive is saved locally');await shot('local-logbook','Live local logbook. This is local storage, not a cloud-save success.');await click('#log-done');
 await click('#account-open');await shot('login-ui','Login interface loads, but authentication cannot be completed without a deployed backend.');await click('#dialog-close');
 probing=true;
 for(const path of ['/api/health','/api/saves','/api/multiplayer/rooms']){
  const result=await page.evaluate(async path=>{try{const response=await fetch(path,{cache:'no-store'});const type=response.headers.get('content-type')??'';let state=null;if(type.includes('json')){const data=await response.json();state=data?.status??data?.error?.code??null;}return {path,status:response.status,contentType:type,state};}catch{return {path,status:0,contentType:'',state:'network failure'};}},path);report.apiProbes.push(result);
 }
 await wait(250);probing=false;
 await click('#multiplayer-open');await shot('multiplayer-blocked','Live multiplayer entry requires sign-in; an authenticated room run is blocked by the absent backend.',true);await click('#mp-back-game');
 const probePage=await browser.newPage();await probePage.setViewport({width:1440,height:900});const probeResponse=await probePage.goto(origin+'/api/health',{waitUntil:'networkidle0',timeout:30000});const errorPath=resolve(bugs,'api-health-response.png');await probePage.screenshot({path:errorPath});report.bugs.push({path:`bugs/live/${runId}/api-health-response.png`,caption:`Actual frontend /api/health response (HTTP ${probeResponse?.status()??0}). This is not a Render health URL; no backend has been provisioned.`});await probePage.close();
 await page.setViewport({width:844,height:390,isMobile:true,hasTouch:true,deviceScaleFactor:1});await page.reload({waitUntil:'networkidle0'});await click('#start');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'live landscape viewport has no horizontal overflow');
 check(await page.$$eval('[data-hold]',bs=>bs.every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44;})),'landscape driving controls remain visible and touch-sized');await shot('landscape','Live desktop-Chrome touch emulation at 844×390; not a physical Android test.');
 check(report.applicationErrors.length===0,'no unhandled application errors in the exercised live frontend journey');check(report.unexpectedConsoleErrors.length===0,'no unexpected console/WebGL errors (intentional API probes recorded separately)');
 report.status='frontend_passed_backend_blocked';
}catch(error){report.status='failed';report.failure=safe(error.message);console.error('LIVE CHECK FAILED:',report.failure);await shot('failure','Actual live verification failure; preserved for investigation.',true).catch(()=>{});process.exitCode=1;}
finally{
 report.verifiedAt=new Date().toISOString();await writeFile(resolve(verification,`live-${runId}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,passed:report.checks.length,report:`verification/live-${runId}.json`,apiProbes:report.apiProbes}));
 const child=browser.process();if(child){const release=()=>{child.stdout?.destroy();child.stderr?.destroy();};if(child.exitCode!==null)release();else child.once('exit',release);}await browser.close();
}
