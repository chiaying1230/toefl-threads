// One-off p2 V3 renderer. Existing Playwright / Edge / ffmpeg only.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {serve} from './video/server.mjs';
const out='docs/p2-v3';fs.mkdirSync(out,{recursive:true});
const {chromium}=await import(pathToFileURL('C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const server=serve(process.cwd(),8124);let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage({viewport:{width:1080,height:1920}});
 await page.goto('http://localhost:8124/scripts/video/p2-v3.html');await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);
 const times=[0,.8,2.9,5.9,9,12.8,15,17.5,19.6,23,25.6,27.5,29.5,31];
 for(const t of times){await page.evaluate(t=>window.renderFrame(t),t);await page.screenshot({path:`${out}/p2-v3.still-${t}.png`});}
 // Inspect all frames, including transitions: visible text may be cropped only at the feed edges.
 const issues=[];for(let t=0;t<31.5;t+=.2){const errors=await page.evaluate(t=>{window.renderFrame(t);return [...document.querySelectorAll('.inner,.body,.zh,.comment,.boxes')].flatMap(e=>e.scrollWidth>e.clientWidth+2?[`${e.id||e.className}: horizontal overflow`]:[]);},t);issues.push(...errors);}
 if(issues.length)throw Error([...new Set(issues)].join('\n'));
 fs.writeFileSync(`${out}/layout-audit.json`,JSON.stringify({samples:158,issues:[],times,duration:31.5},null,2));
 if(process.argv.includes('--stills')){console.log('stills and audit complete');}else{
 const ff=spawn('C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe',['-y','-loglevel','error','-f','image2pipe','-framerate','30','-c:v','mjpeg','-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','17','-t','31.5','-movflags','+faststart',`${out}/p2-v3.mp4`],{stdio:['pipe','inherit','inherit']});
 const done=new Promise((resolve,reject)=>{ff.on('close',resolve);ff.on('error',reject)});
 for(let i=0;i<945;i++){await page.evaluate(t=>window.renderFrame(t),i/30);const frame=await page.screenshot({type:'jpeg',quality:93});if(!ff.stdin.write(frame))await new Promise(r=>ff.stdin.once('drain',r));if(i%150===0)console.log(`${i}/945 frames`);}
 ff.stdin.end();if(await done!==0)throw Error('ffmpeg failed');console.log('p2 V3 complete: 31.5s / 945 frames');
 }
}finally{await browser?.close();server.close();}
