// One p2 V4 prototype, not a shared template or batch pipeline.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {serve} from './video/server.mjs';
const out='docs/p2-v4',plan=JSON.parse(fs.readFileSync(`${out}/p2-v4.plan.json`,'utf8'));
const {chromium}=await import(pathToFileURL('C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const server=serve(process.cwd(),8126);let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage({viewport:{width:1080,height:1920}});
 await page.goto('http://localhost:8126/scripts/video/p2-v4.html');await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);
 const times=[0,.7,1.7,...plan.lines.map(l=>Math.min(plan.duration-.03,l.start+.45))];
 for(const t of times){await page.evaluate(t=>window.renderFrame(t),t);await page.screenshot({path:`${out}/p2-v4.still-${t.toFixed(2)}.png`});}
 const issues=new Map();for(let t=0;t<plan.duration;t+=1/30){const errors=await page.evaluate(t=>window.audit(t),t);for(const error of errors)if(!issues.has(error))issues.set(error,t);}
 fs.writeFileSync(`${out}/layout-audit.json`,JSON.stringify({samples:plan.frames,issues:[...issues],checks:['text horizontal overflow','active reading cue within white viewport'],times},null,2));
 if(issues.size)throw Error(JSON.stringify([...issues]));
 if(process.argv.includes('--stills')){console.log('stills and all-frame cue audit complete');}else{
 const ff=spawn('C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe',['-y','-loglevel','error','-f','image2pipe','-framerate','30','-c:v','mjpeg','-i','-','-i',`${out}/narration.wav`,'-map','0:v','-map','1:a','-c:v','libx264','-pix_fmt','yuv420p','-crf','17','-c:a','aac','-b:a','160k','-t',String(plan.duration),'-movflags','+faststart',`${out}/p2-v4.mp4`],{stdio:['pipe','inherit','inherit']});
 const done=new Promise((resolve,reject)=>{ff.on('close',resolve);ff.on('error',reject)});
 for(let i=0;i<plan.frames;i++){await page.evaluate(t=>window.renderFrame(t),i/30);const frame=await page.screenshot({type:'jpeg',quality:93});if(!ff.stdin.write(frame))await new Promise(r=>ff.stdin.once('drain',r));if(i%150===0)console.log(`${i}/${plan.frames} frames`);}
 ff.stdin.end();if(await done!==0)throw Error('ffmpeg failed');console.log(`p2 V4: ${plan.duration}s / ${plan.frames} frames / real narration`);
 }
}finally{await browser?.close();server.close();}
