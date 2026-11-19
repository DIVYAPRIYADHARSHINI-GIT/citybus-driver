// Separate HTTPS static/frontend and API origins. No Vite /api proxy is used.
// Certificates and credentials are generated in an owned temporary directory.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createServer as httpsServer,request as httpsRequest} from 'node:https';
import {createServer as netServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
const dir=await mkdtemp(join(tmpdir(),'citybus-hosting-')),backend=resolve('../backend'),python=join(backend,'.venv/bin/python');
const apiPort=8019,frontPort=4189,front=`https://app.citybus.test:${frontPort}`,api=`https://api.citybus.test:${apiPort}`,out=join(dir,'dist');
let apiProcess,server,browser,checks=0;const errors=[],wsUrls=[],requests=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
const check=(v,s)=>{assert.ok(v,s);console.log(`PASS ${++checks}: ${s}`);};
async function free(port){const s=netServer();await new Promise((r,j)=>s.once('error',j).listen(port,'127.0.0.1',r));await new Promise(r=>s.close(r));}
const health=()=>new Promise((resolve,reject)=>{const req=httpsRequest(`https://127.0.0.1:${apiPort}/health`,{rejectUnauthorized:false},r=>{r.resume();resolve(r.statusCode===200);});req.on('error',reject);req.end();});
try{
 await free(apiPort);await free(frontPort);
 const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
 const ssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=citybus.test','-addext','subjectAltName=DNS:app.citybus.test,DNS:api.citybus.test,IP:127.0.0.1'],{encoding:'utf8'});if(ssl.status)throw Error('Test certificate generation failed: '+ssl.stderr);
 const env={...process.env,DATABASE_URL:`sqlite:///${dir}/test.db`,JWT_SECRET:randomBytes(48).toString('hex'),ENVIRONMENT:'development',COOKIE_SECURE:'true',COOKIE_SAMESITE:'lax',CORS_ORIGINS:JSON.stringify([front]),ACCESS_TOKEN_SECONDS:'4',RATE_LIMIT_PER_MINUTE:'5000'};
 for(const args of [['-m','alembic','upgrade','head'],['-m','app.seed']]){const r=spawnSync(python,args,{cwd:backend,env,encoding:'utf8'});if(r.status)throw Error(r.stderr);}
 apiProcess=spawn(python,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(apiPort),'--workers','1','--ssl-keyfile',key,'--ssl-certfile',cert,'--no-access-log'],{cwd:backend,env,stdio:['ignore','pipe','pipe']});apiProcess.stdout.resume();apiProcess.stderr.resume();
 let ready=false;for(let i=0;i<100;i++){try{if(await health()){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'isolated HTTPS API ready');
 // Deliberately configure ws:// to prove the HTTPS page upgrades it to wss://.
 const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',out,'--emptyOutDir'],{env:{...process.env,VITE_API_BASE_URL:`${api}/api`,VITE_WS_URL:`ws://api.citybus.test:${apiPort}/api/multiplayer/ws`},encoding:'utf8'});if(build.status)throw Error(build.stderr+build.stdout);
 server=httpsServer({key:await readFile(key),cert:await readFile(cert)},async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,front).pathname),file=resolve(out,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(out+sep)){res.writeHead(403);res.end();return;}const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'}[extname(file)]??'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(frontPort,'127.0.0.1',r));
 browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--ignore-certificate-errors','--no-proxy-server','--host-resolver-rules=MAP app.citybus.test 127.0.0.1, MAP api.citybus.test 127.0.0.1']});
 const page=await browser.newPage();await page.setViewport({width:1366,height:900});let refreshes=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource.*401/.test(m.text()))errors.push(m.text());});page.on('request',r=>{requests.push(r.url());if(r.url()===`${api}/api/auth/refresh`)refreshes++;});
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');cdp.on('Network.webSocketCreated',e=>wsUrls.push(e.url));
 const click=s=>page.locator(s).setTimeout(20000).click();
 await page.goto(front,{waitUntil:'networkidle0'});await click('#account-open');await click('#auth-toggle');await page.type('#account-email','hosting-test@example.com');await page.type('#account-name','Hosting Test');await page.type('#account-password','test-only-hosting-password-42');await click('#account-submit');await page.waitForSelector('#profile-done',{visible:true});await click('#profile-done');
 await page.waitForFunction(()=>window.citybus.online().connected&&window.citybus.online().cloudVersion>=1,{timeout:30000});
 check(requests.some(u=>u===`${api}/api/auth/register`),'built VITE_API_BASE_URL directs registration to the separate API origin');
 check(!requests.some(u=>u.startsWith(front+'/api/')),'static frontend origin receives no REST API calls or proxy requests');
 const cookies=await browser.defaultBrowserContext().cookies(api);const cookie=cookies.find(c=>c.name==='citybus_refresh');check(cookie?.httpOnly&&cookie.secure&&cookie.domain==='api.citybus.test','refresh credential is Secure, HttpOnly and host-only on the API domain');
 check(!await page.evaluate(()=>document.cookie.includes('citybus_refresh')),'frontend JavaScript cannot read the refresh credential');
 const account=await page.evaluate(()=>window.citybus.online().account);await delay(4500);await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>window.citybus.online().connected&&!window.citybus.online().busy,{timeout:30000});
 check(await page.evaluate(id=>window.citybus.online().account===id,account)&&refreshes>0,'cross-origin credentialed refresh restores the same account after access expiry/reload');
 await click('#multiplayer-open');await click('#mp-private');await click('#mp-create');await page.waitForFunction(()=>window.citybus.multiplayer().active,{timeout:30000});
 check(wsUrls.includes(`wss://api.citybus.test:${apiPort}/api/multiplayer/ws`),'VITE_WS_URL is used and upgraded from ws to a real wss connection on HTTPS');
 check(await page.evaluate(()=>window.citybus.multiplayer().room?.members.length===1),'real authenticated room handshake succeeds across origins');
 await mkdir('test-results/deployment',{recursive:true});await page.screenshot({path:'test-results/deployment/https-room.png'});await click('#mp-close-room');await page.waitForFunction(()=>!window.citybus.multiplayer().active);
 check(!errors.length,`no unexpected application/WebGL/console errors: ${errors.join(';')}`);
 await writeFile('test-results/deployment/report.json',JSON.stringify({checks,errors,refreshes,webSocketUrls:wsUrls,method:'Separate local HTTPS subdomains under citybus.test, static frontend (no proxy), env-built client, real FastAPI/SQLite; generated self-signed test certificates accepted ONLY in this test. Not a Vercel/Render deployment or third-party-cookie-policy certification.',finished:new Date().toISOString()},null,2));
}catch(e){console.error(e,errors);process.exitCode=1;}finally{
 if(browser){const child=browser.process();if(child)child.once('exit',()=>{child.stdout?.destroy();child.stderr?.destroy();});await browser.close();}
 if(server)await new Promise(r=>server.close(r));
 if(apiProcess&&apiProcess.exitCode===null)await new Promise(r=>{apiProcess.once('exit',r);apiProcess.kill('SIGTERM');});
 await rm(dir,{recursive:true,force:true});
}
