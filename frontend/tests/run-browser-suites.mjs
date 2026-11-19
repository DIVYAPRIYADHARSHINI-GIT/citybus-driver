import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const suites=['e2e','city-e2e','city-roadside','online-e2e','tycoon-e2e','fleet-e2e','multiplayer-e2e','stage6-e2e','stage6-multiplayer','landscape-e2e','final-smoke'];
await mkdir('test-results/stage6/regression',{recursive:true});const results=[];
for(const suite of suites){const start=Date.now();console.log(`\n===== ${suite} =====`);let output='';const child=spawn(process.execPath,[`tests/${suite}.mjs`],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',s=>{output+=s;process.stdout.write(s);});child.stderr.on('data',s=>{output+=s;process.stderr.write(s);});const exit=await new Promise(r=>child.on('close',r));results.push({suite,exit,seconds:(Date.now()-start)/1000});await writeFile(`test-results/stage6/regression/${suite}.log`,output);await writeFile('test-results/stage6/regression/report.json',JSON.stringify({finished:new Date().toISOString(),results},null,2));}
if(results.some(r=>r.exit!==0))process.exitCode=1;
