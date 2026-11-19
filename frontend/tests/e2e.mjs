import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BASE_URL??'http://127.0.0.1:4173';
const executablePath=process.env.CHROME_PATH??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage(),errors=[],requests=[];let checks=0;
await mkdir('test-results',{recursive:true});
const check=(condition,label)=>{assert.ok(condition,label);checks++;console.log(`PASS ${checks}: ${label}`);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const snap=()=>page.evaluate(()=>window.citybus.snapshot());
const state=fn=>page.waitForFunction(fn,{timeout:15000});
const click=async sel=>{await page.waitForSelector(sel,{visible:true});await page.click(sel);};
const key=async key=>{await page.keyboard.press(key);await delay(90);};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
try{
  await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
  await page.goto(base,{waitUntil:'networkidle0'});await state(()=>window.citybus?.snapshot().frames>10);
  check(await page.title()==='CityBus Driver — Take the wheel','production entry loads with the correct title');
  check((await snap()).drawCalls<250,'static geometry is batched below 250 visible draw calls');
  check(await page.$eval('#start',b=>b.getBoundingClientRect().height)>=44,'primary start control meets 44px touch height');
  await page.screenshot({path:'test-results/01-home-desktop.png'});
  await click('[data-nav="garage"]');check(await page.$eval('#garage-copy',e=>!e.classList.contains('hidden')),'garage is a real scene view');
  await click('.swatch[data-color="#ba553f"]');check(await page.$eval('.swatch[data-color="#ba553f"]',e=>e.getAttribute('aria-pressed')==='true'),'paint selection is reflected in its state');
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('citybus-driver.v1')).paint)==='#ba553f','paint persists to local storage');
  await page.screenshot({path:'test-results/02-garage.png'});
  await click('[data-nav="drive"]');await click('#tutorial');check((await snap()).mode==='cockpit','guided drive enters the cockpit');
  check(!(await snap()).running&&(await snap()).parking,'bus starts safely with engine off and parking brake on');
  await key('i');check((await snap()).running,'keyboard ignition starts the engine');
  await key('p');check(!(await snap()).parking,'keyboard parking brake releases');
  await key('e');check((await snap()).gear===1,'automatic selector enters drive');
  await page.keyboard.down('w');await state(()=>window.citybus.snapshot().speed>2.5&&window.citybus.snapshot().position[2]<34);await page.keyboard.up('w');
  const moving=await snap();check(moving.position[2]<43&&moving.speed>2,'real physics moves the bus forwards, not a visual animation');
  await key('o');check(!(await snap()).doors,'opening doors is blocked while moving');
  await page.keyboard.down('s');await state(()=>Math.abs(window.citybus.snapshot().speed)<.13);await page.keyboard.up('s');
  check(Math.abs((await snap()).speed)<.2,'service brake actually stops the bus');
  await delay(150);check(await page.$eval('#walkthrough',e=>e.classList.contains('hidden')),'guided walkthrough completes after a genuine drive and stop');
  await key('p');await key('o');check((await snap()).doors,'doors open at a stop');
  await key('u');check((await snap()).ramp,'ramp deploys only with doors open and parking applied');
  await key('o');check((await snap()).doors,'doors cannot close over an extended ramp');
  await key('u');await key('o');check(!(await snap()).doors&&!(await snap()).ramp,'ramp and doors retract through their real actions');
  await click('[data-action="lights"]');await click('[data-action="wipers"]');await click('[data-action="retarder"]');await click('[data-action="radio"]');
  check((await snap()).lights&&(await snap()).wipers&&(await snap()).retarder===1&&(await snap()).radio===1,'cockpit buttons affect live systems');
  await click('#ticket-open');check((await snap()).paused,'ticket interaction pauses the proving-ground simulation');
  await click('[data-change="250"]');check((await page.$eval('#ticket-result',e=>e.textContent)).includes('hello'),'ticket practice requires a greeting');
  await click('#greet');await click('[data-change="200"]');check((await page.$eval('#ticket-result',e=>e.textContent)).includes('Not quite'),'incorrect change is rejected');
  await click('[data-change="250"]');check((await page.$eval('#ticket-result',e=>e.textContent)).includes('Ticket issued'),'correct change completes a practice transaction');
  check(await page.$$eval('[data-change]',bs=>bs.every(b=>b.disabled)),'ticket cannot be issued repeatedly for the same transaction');
  await page.select('#fare','600');check(await page.$eval('#ticket-question',e=>e.textContent)==='Payment is too low','underpayment is explicitly refused');
  await click('#ticket-done');check(!(await snap()).paused,'closing the ticket terminal resumes the simulation');
  await click('#settings');await page.select('#weather-select','rain');await page.select('#quality-select','high');
  await page.$eval('#time-slider',e=>{e.value='22';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('#settings-done');check((await snap()).weather==='rain'&&(await snap()).quality==='high','night rain and high-quality postprocessing are live');
  await delay(500);await page.screenshot({path:'test-results/03-cockpit-night-rain.png'});
  await click('#settings');await page.select('#weather-select','clear');await page.select('#quality-select','balanced');await page.$eval('#time-slider',e=>{e.value='15';e.dispatchEvent(new Event('input',{bubbles:true}));});await click('#settings-done');
  await key('m');check(!(await snap()).automatic&&(await snap()).gear===0,'manual mode selects neutral at rest');
  await key('e');check((await snap()).gear===0,'manual gear change without clutch is refused');
  await page.keyboard.down('Shift');await key('e');check((await snap()).gear===1,'manual gear change works with clutch');await page.keyboard.up('Shift');await state(()=>window.citybus.snapshot().stalled);
  check(!(await snap()).running,'dumping the clutch at rest really stalls the engine');
  await page.keyboard.down('Shift');await key('q');await key('i');await page.keyboard.up('Shift');check((await snap()).running&&(await snap()).gear===0,'engine restarts after selecting neutral');
  await key('m');await key('e');await key('p');await page.keyboard.down('w');await state(()=>window.citybus.snapshot().speed>1);
  await key('Escape');const atPause=await snap();await delay(400);check(JSON.stringify((await snap()).position)===JSON.stringify(atPause.position),'pause freezes the physics state');await page.keyboard.up('w');
  await click('#replay-open');check((await snap()).replaying,'last-30-second trajectory replay opens');await delay(400);check(JSON.stringify((await snap()).position)===JSON.stringify(atPause.position),'replay never mutates the authoritative physics body');await key('Escape');await click('#recover');
  check((await snap()).parking&&(await snap()).gear===0,'recovery resets to a safe parked state');
  await key('c');check((await snap()).mode==='chase','camera hotkey switches to exterior chase');await page.screenshot({path:'test-results/04-driving-chase.png'});await key('c');await key('c');
  // Real ray-picking: look down so the physical dashboard switches are exposed.
  await page.mouse.move(600,300);await page.mouse.down();await page.mouse.move(600,425,{steps:10});await page.mouse.up();
  const points=await page.evaluate(()=>window.citybus.controlPoints());
  const point=points.find(p=>p.action==='ignition'&&p.x>0&&p.x<1440&&p.y>130&&p.y<550);
  if(point){const before=(await snap()).running;await page.mouse.click(point.x,point.y);await delay(150);check((await snap()).running!==before,'raycast click on the physical ignition switch changes engine state');}
  else throw new Error(`Physical ignition is not exposed after look-down: ${JSON.stringify(points.filter(p=>p.action==='ignition'))}`);
  await page.screenshot({path:'test-results/05-cockpit-controls.png'});
  await click('#pause');await click('#finish');check(!((await snap()).started),'finishing returns to the menu');
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('citybus-driver.v1')).sessions.length)===1,'completed session is saved once');await click('#log-done');
  await page.reload({waitUntil:'networkidle0'});await state(()=>window.citybus?.snapshot().frames>5);check(await page.evaluate(()=>JSON.parse(localStorage.getItem('citybus-driver.v1')).sessions.length)===1,'logbook survives a full reload');
  await page.evaluate(()=>navigator.serviceWorker.ready);await state(()=>!!navigator.serviceWorker.controller);await page.setOfflineMode(true);await page.reload({waitUntil:'networkidle0'});await state(()=>window.citybus?.snapshot().frames>5);
  check(await page.$eval('#loading',e=>e.classList.contains('hidden')),'installed production build reloads entirely offline');await click('#start');await key('i');check((await snap()).running,'offline mode is actually playable');await page.setOfflineMode(false);await click('#pause');await click('#finish');await click('#log-done');
  // Mobile viewport, real touch events, pointer capture and keyboard alternative.
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});await delay(300);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile home has no horizontal overflow');await page.screenshot({path:'test-results/06-home-mobile.png'});
  await click('#start');await click('#controls-toggle');await click('[data-action="ignition"]');await click('[data-action="parking"]');await click('[data-action="gearUp"]');await click('#controls-toggle');
  const drive=await page.$('[data-hold="throttle:1"]'),rect=await drive.boundingBox();await page.touchscreen.touchStart(rect.x+rect.width/2,rect.y+rect.height/2);await state(()=>window.citybus.snapshot().speed>1);await page.touchscreen.touchEnd();
  check((await snap()).speed>1,'touch accelerator moves the real physics body');await delay(100);check((await snap()).throttle===0,'touch release clears throttle instead of sticking');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));check((await snap()).paused,'focus loss automatically pauses mobile driving');await click('#resume');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile driving has no horizontal overflow');await page.screenshot({path:'test-results/07-cockpit-mobile.png'});
  await click('#pause');await click('#recover');
  // Inject a standard gamepad through the browser API; all actions still go through Input.
  await page.evaluate(()=>{window.__pad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__pad]});});
  await page.evaluate(()=>window.__pad.buttons[1]={pressed:true,value:1});await delay(150);await page.evaluate(()=>window.__pad.buttons[1]={pressed:false,value:0});
  check(!(await snap()).parking,'gamepad face button releases the parking brake');
  await page.evaluate(()=>window.__pad.buttons[3]={pressed:true,value:1});await delay(150);await page.evaluate(()=>{window.__pad.buttons[3]={pressed:false,value:0};window.__pad.buttons[7]={pressed:true,value:1};});await state(()=>window.citybus.snapshot().speed>1);
  check((await snap()).speed>1,'standard gamepad trigger produces acceleration');
  await page.evaluate(()=>{window.__pad.connected=false;window.dispatchEvent(new Event('gamepaddisconnected'));});await delay(100);check((await snap()).throttle===0,'gamepad disconnect clears held input');
  await click('#pause');await click('#finish');await click('#log-done');
  // Corrupt saves must not be overwritten automatically.
  await page.evaluate(()=>localStorage.setItem('citybus-driver.v1','{corrupt-save'));await page.reload({waitUntil:'networkidle0'});await state(()=>window.citybus?.snapshot().frames>5);await click('[data-nav="garage"]');await click('.swatch[data-color="#25445d"]');
  check(await page.evaluate(()=>localStorage.getItem('citybus-driver.v1'))==='{corrupt-save','corrupt save is protected from automatic overwrite');
  check(requests.every(u=>u.startsWith(base)||u.startsWith('data:')||u.startsWith('blob:')),'no third-party runtime network requests');
  check(errors.length===0,`no browser JavaScript or WebGL errors: ${errors.join('\n')}`);
  await writeFile('test-results/e2e-report.json',JSON.stringify({checks,errors,base,finished:new Date().toISOString()},null,2));console.log(`\n${checks} browser checks passed.`);
}catch(error){await page.screenshot({path:'test-results/failure.png'}).catch(()=>{});console.error('FAILED',error);console.error('BROWSER ERRORS',errors);process.exitCode=1;}finally{
  // Chrome's main process can exit while a helper retains inherited log pipes.
  // Close only that owned child's pipes after exit; keep every assertion and
  // failure exit code intact instead of forcing the test process to exit(0).
  const child=browser.process();
  if(child){const release=()=>{child.stdout?.destroy();child.stderr?.destroy();};if(child.exitCode!==null||child.signalCode!==null)release();else child.once('exit',release);}
  await browser.close();
}
