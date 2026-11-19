// Rebuild the publication PDF from the tracked Markdown and actual screenshots.
// No external fonts, image services, credentials or account data are fetched.
import {readFile,writeFile,access,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(resolve(root,'frontend/package.json'));
const puppeteer=require('puppeteer');
const repo='https://github.com/DIVYAPRIYADHARSHINI-GIT/citybus-driver';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=url=>/^https?:\/\//.test(url)?url:repo+'/blob/main/'+url.replace(/^\.\//,'');
function inline(s){return escape(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_m,label,url)=>`<a href="${escape(link(url))}">${label}</a>`);}
const lines=(await readFile(resolve(root,'FINAL_REPORT.md'),'utf8')).split('\n'),parts=[];
for(let i=0;i<lines.length;){const line=lines[i];if(!line.trim()){i++;continue;}
 if(line.startsWith('```')){const code=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i++]);i++;parts.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);continue;}
 const heading=/^(#{1,4}) (.*)$/.exec(line);if(heading){parts.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);i++;continue;}
 const image=/^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line);if(image){await access(resolve(root,image[2]));i++;while(i<lines.length&&!lines[i].trim())i++;let caption='';if(lines[i]?.startsWith('**Caption:**'))caption=lines[i++];parts.push(`<figure><img src="${escape(image[2])}" alt="${escape(image[1])}"><figcaption>${inline(caption||image[1])}</figcaption></figure>`);continue;}
 if(line.startsWith('|')){const rows=[];while(i<lines.length&&lines[i].startsWith('|')){const cells=lines[i++].split('|').slice(1,-1).map(s=>s.trim());if(cells.every(c=>/^:?-+:?$/.test(c)))continue;rows.push(cells);}parts.push('<table><thead><tr>'+rows.shift().map(c=>`<th>${inline(c)}</th>`).join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>`<td>${inline(c)}</td>`).join('')+'</tr>').join('')+'</tbody></table>');continue;}
 if(/^[-*] /.test(line)||/^\d+\. /.test(line)){const ordered=/^\d+\. /.test(line),items=[];while(i<lines.length&&(ordered?/^\d+\. /:/^[-*] /).test(lines[i]))items.push(lines[i++].replace(ordered?/^\d+\. /:/^[-*] /,''));parts.push(`<${ordered?'ol':'ul'}>`+items.map(s=>'<li>'+inline(s)+'</li>').join('')+`</${ordered?'ol':'ul'}>`);continue;}
 const paragraph=[];while(i<lines.length&&lines[i].trim()&&!/^(#{1,4} |!\[|\||```|[-*] |\d+\. )/.test(lines[i]))paragraph.push(lines[i++]);parts.push('<p>'+inline(paragraph.join(' '))+'</p>');
}
const css=`@page{size:A4;margin:16mm 18mm 19mm}*{box-sizing:border-box}body{font:10pt/1.43 Arial,Helvetica,sans-serif;color:#20382d;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:28pt;line-height:1.12;color:#173f2d;border-bottom:3px solid #9ac970;padding-bottom:12px;margin:0 0 16px}h2{font-size:15pt;color:#1c5138;margin:21px 0 10px;break-after:avoid}h3{font-size:11pt;margin:16px 0 8px;break-after:avoid}p{margin:8px 0}li{margin:5px 0}a{color:#236e4d;overflow-wrap:anywhere;text-decoration:none}code{font:8.7pt/1.4 'Courier New',monospace;overflow-wrap:anywhere}pre{padding:12px;background:#eef3e9;border:1px solid #cddcc7;border-radius:4px;white-space:pre-wrap;break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:9pt;margin:12px 0}th{background:#1e4e37;color:white;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #d6e2d4;vertical-align:top}tr:nth-child(even){background:#f1f5ed}tr{break-inside:avoid}thead{display:table-header-group}figure{break-inside:avoid;border:1px solid #d6e2d4;padding:8px;margin:12px 0 18px;border-radius:4px}figure img{display:block;max-width:100%;width:auto;max-height:82mm;margin:0 auto}figcaption{font-size:8.5pt;color:#48604f;margin-top:8px}ul,ol{padding-left:19px}ol,li{break-inside:avoid}body>ul:first-of-type{padding:12px 24px;background:#edf5e5;border-left:4px solid #70a34d}`;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CityBus Driver — Final Publication Report</title><style>${css}</style></head><body>${parts.join('\n')}</body></html>`;
await writeFile(resolve(root,'FINAL_REPORT.html'),html);
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto(pathToFileURL(resolve(root,'FINAL_REPORT.html')).href,{waitUntil:'load'});await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));await page.emulateMediaType('print');await page.pdf({path:resolve(root,'FINAL_REPORT.pdf'),format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;padding:0 18mm;font:8px Arial;color:#58705c;display:flex;justify-content:space-between"><span>CITYBUS DRIVER · PUBLICATION REPORT · 19 NOVEMBER 2026</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'});}
finally{const child=browser.process();if(child){const release=()=>{child.stdout?.destroy();child.stderr?.destroy();};if(child.exitCode!==null)release();else child.once('exit',release);}await browser.close();}
// Keep the earlier report filename current inside this publication repository.
await copyFile(resolve(root,'FINAL_REPORT.pdf'),resolve(root,'frontend/docs/CityBus_Driver_Final_Deployment_Report.pdf'));
await writeFile(resolve(root,'frontend/docs/citybus-driver-final-report.html'),html.replace('<head>','<head><base href="../../">'));
console.log('Exported FINAL_REPORT.pdf and refreshed the earlier CityBus report filename.');
