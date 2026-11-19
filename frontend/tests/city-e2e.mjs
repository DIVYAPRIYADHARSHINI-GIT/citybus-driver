import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BASE_URL??'http://127.0.0.1:4173';
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage();await page.setViewport({width:1440,height:900,deviceScaleFactor:1});await mkdir('test-results/city',{recursive:true});
const errors=[],requests=[];let checks=0,tickets=0;const log=[];
const check=(ok,label)=>{assert.ok(ok,label);console.log(`PASS ${++checks}: ${label}`);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>page.evaluate(()=>({bus:window.citybus.snapshot(),city:window.citybus.city()}));
const click=async sel=>{await page.waitForSelector(sel,{visible:true,timeout:10000});await page.click(sel);};
const key=async k=>{await page.keyboard.press(k);await delay(100);};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
async function driveStop(){
  const result=await page.evaluate(async()=>{
    // A test-driver sends ordinary keyboard events. It cannot teleport, set velocity,
    // mutate physics or alter route progress. The production app has read-only diagnostics.
    const held=new Set();const hold=(code,on)=>{if(on===held.has(code))return;on?held.add(code):held.delete(code);window.dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,key:code.slice(-1).toLowerCase(),bubbles:true}));};
    const start=performance.now();let minZ=Infinity,maxSpeed=0,frames=0;
    while(performance.now()-start<120000){const b=window.citybus.snapshot(),c=window.citybus.city();if(c.incidents.broken)return {ok:false,reason:'breakdown',b,c};
      if(b.paused){await new Promise(r=>setTimeout(r,100));continue;}
      const remaining=b.position[2]-c.stop.z;minZ=Math.min(minZ,b.position[2]);maxSpeed=Math.max(maxSpeed,b.speed);frames++;
      let goal=c.stop.z;
      // Northbound Library Local crosses W junction. Stop the bus FRONT before its line.
      if(c.index===2&&b.position[2]>23&&c.signals.NS!=='green')goal=Math.max(goal,24);
      const distance=b.position[2]-goal,target=Math.min(8,Math.sqrt(Math.max(0,(distance-1.5)*4)));
      const braking=b.speed>target+.25||distance<2.1;
      hold('KeyW',!braking&&b.speed<target-.2);hold('KeyS',braking&&b.speed>.06);
      if(remaining<6&&remaining>-8&&Math.abs(b.speed)<.13){hold('KeyW',false);hold('KeyS',false);return {ok:true,minZ,maxSpeed,frames,remaining};}
      if(remaining<-12){hold('KeyW',false);hold('KeyS',true);await new Promise(r=>setTimeout(r,1500));hold('KeyS',false);return {ok:false,reason:'overshot',remaining,b,c};}
      await new Promise(r=>setTimeout(r,90));
    }
    hold('KeyW',false);hold('KeyS',false);return {ok:false,reason:'timeout',b:window.citybus.snapshot(),c:window.citybus.city()};
  });
  console.log('DRIVE',JSON.stringify(result));assert.ok(result.ok,`Real drive failed: ${JSON.stringify(result)}`);check(result.maxSpeed>.2,'bus drove under physical engine power into the next stop zone');
}
async function serviceStop(index){
  let s=await state();if(!s.bus.parking)await key('p');
  // Repeated digital brake applications consume real air. Wait for the actual
  // compressor rather than bypassing the pressure interlock in a test hook.
  await page.waitForFunction(()=>window.citybus.snapshot().air>4.5,{timeout:60000});
  if(!s.bus.doors)await key('o');await delay(150);check((await state()).city.phase==='servicing',`stop ${index+1} service begins only inside its zone`);await key('u');
  let loops=0;
  while(loops++<160){s=await state();if(s.city.phase==='ready')break;
    if(s.city.event){await click('#city-event');const choice=s.city.event==='bag'?'return':s.city.event==='no-ticket'?'sell':'assist';await click(`[data-passenger="${choice}"]`);await click('#passenger-done');log.push({event:s.city.event,stop:index});await delay(100);}
    s=await state();if(s.city.ticket){await click('#city-ticket');await click('#city-greet');if(await page.$('#city-offer-ticket'))await click('#city-offer-ticket');const change=s.city.ticket.cash-s.city.ticket.fare;await click(`[data-city-change="${change}"]`);check((await page.$eval('#city-ticket-result',e=>e.textContent)).includes('issued'),'real passenger ticket credits the route fare');tickets++;await click('#city-ticket-done');}
    await delay(150);
  }
  s=await state();assert.equal(s.city.phase,'ready',`Boarding did not finish: ${JSON.stringify(s)}`);check(s.city.queue===0,'waiting queue is fully boarded before departure');
  if(s.bus.ramp)await key('u');await key('o');await delay(250);s=await state();check(s.city.index===index+1,'closing doors after service advances exactly one route stop');
  if(!s.city.completed&&s.bus.parking)await key('p');
}
try{
 await page.goto(base,{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.citybus?.snapshot().frames>4);
 await click('#city-launch');check(await page.$$eval('[data-route]',bs=>bs.length)===3,'three predefined city routes are selectable');await page.select('#city-density','low');await click('[data-route="21"]');
 await page.waitForFunction(()=>window.citybus.city()?.chunks>0);let s=await state();check(s.city.route==='21'&&s.city.phase==='approach','city starts separately without completing or faking a stop');check(s.city.agents<=16&&s.city.chunks>0,'low density and nearby city chunks are active');
 check(s.bus.position[0]<-230&&s.bus.position[2]>200,'city uses its own terminal spawn, not the proving ground');await key('c');await page.screenshot({path:'test-results/city/route-start.png'});
 await click('#city-gps');const firstPath=(await state()).city.gps.path;await click('[data-destination="university"]');check((await state()).city.gps.path.length>firstPath.length,'tap-to-set GPS changes the actual graph route');await click('#gps-detour');check((await state()).city.incidents.detour,'detour toggle applies closure avoidance');await click('#gps-route-stop');await click('#gps-done');
 await key('i');await key('e');await key('p');
 for(let index=0;index<3;index++){await driveStop();check((await state()).city.inside,`stop ${index+1} accepts physical position and heading`);await serviceStop(index);await page.screenshot({path:`test-results/city/served-${index+1}.png`});}
 s=await state();check(s.city.completed&&s.city.result.served===3&&s.city.result.missed===0,'complete Library Local route serves all three stops without skips');check(s.city.onboard===0,'all passengers alight at their destinations');check(tickets>0&&s.city.result.fares>0,'fares derive from issued passenger tickets');check(s.bus.paused,'route results pause the actual bus');check(!!(await page.$('#city-finish')),'route has a real results screen');
 const result=s.city.result;await page.screenshot({path:'test-results/city/results.png'});await click('#city-finish');await click('#log-done');check((await state()).city===null,'finishing unloads city mode');
 check(await page.evaluate(()=>JSON.parse(localStorage.getItem('citybus-driver.v1')).sessions[0].route.served)===3,'route score and fares persist in the existing v1 save');
 await click('#start');await key('i');await key('e');await key('p');await page.keyboard.down('w');await page.waitForFunction(()=>window.citybus.snapshot().speed>1);await page.keyboard.up('w');s=await state();check(s.bus.position[0]>-60&&s.bus.position[0]<-40&&s.bus.position[2]<45,'proving-ground physics works after returning from the city');await click('#pause');await click('#finish');await click('#log-done');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.setOfflineMode(true);await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>window.citybus?.snapshot().frames>4);await click('#city-launch');await click('[data-route="80"]');await page.waitForFunction(()=>window.citybus.city()?.chunks>0);check((await state()).city.route==='80','city geometry, route data and AI load fully offline');await page.setOfflineMode(false);await click('#pause');await click('#finish');await click('#log-done');
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});await page.reload({waitUntil:'networkidle0'});await click('#city-launch');await page.select('#city-density','high');await click('[data-route="36"]');await page.waitForFunction(()=>window.citybus.city()?.chunks>0);s=await state();check(s.city.agents<=22,'high-density mobile city enforces its vehicle cap');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile city has no horizontal page overflow');await page.screenshot({path:'test-results/city/mobile-final.png'});await click('#city-gps');await page.screenshot({path:'test-results/city/mobile-gps.png'});await click('#gps-done');
 check(errors.length===0,`no browser errors: ${errors.join('\n')}`);check(requests.every(u=>u.startsWith(base)||u.startsWith('data:')||u.startsWith('blob:')),'city makes no external network requests');
 await writeFile('test-results/city/e2e-report.json',JSON.stringify({checks,tickets,result,events:log,errors,finished:new Date().toISOString()},null,2));console.log(`${checks} city browser checks passed, ${tickets} tickets sold.`);
}catch(error){console.error('FAIL',error);console.error('STATE',await state().catch(()=>null));console.error('BROWSER ERRORS',errors);await page.screenshot({path:'test-results/city/failure.png'}).catch(()=>{});process.exitCode=1;}finally{await browser.close();}
