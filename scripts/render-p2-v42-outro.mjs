// P2 reference regression + one output. No audio synthesis or alignment rewrite.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
const dir='docs/p2-v4.2-outro';fs.mkdirSync(dir,{recursive:true});fs.mkdirSync('outputs',{recursive:true});
const root=process.cwd();const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wav':'audio/wav'};
const allowed=new Set(['scripts/video/post-reference.html','scripts/video/p2-v42.html','scripts/video/components/Mascot.js','scripts/video/reference/post.css','scripts/video/reference/outro.css','scripts/video/reference/Components.js','scripts/video/reference/PostTemplate.js','scripts/video/reference/ReadingCue.js','scripts/video/episodes/p2-v42-outro.json','docs/p2-v4.2/p2-v4.2.plan.json','docs/p2-v4.2/narration.wav']);
allowed.add('scripts/video/assets/answer-correct.wav');
allowed.add('scripts/video/assets/social-soft-groove.wav');
const server=http.createServer((req,res)=>{const file=decodeURIComponent(req.url.split('?')[0]).replace(/^\//,'');if(!allowed.has(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(fs.readFileSync(path.join(root,file)));}).listen(8130,'127.0.0.1');
const {chromium}=await import(pathToFileURL('C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await browser.newPage({viewport:{width:1080,height:1920}});await page.goto('http://127.0.0.1:8130/scripts/video/post-reference.html');await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);
 const spec=await page.evaluate(()=>({duration:window.template.duration,start:window.template.start}));const frames=Math.ceil(spec.duration*30);spec.duration=frames/30;spec.frames=frames;
 // Compare old and extracted reference directly, without re-encoding the approved baseline.
 const baseline=await browser.newPage({viewport:{width:1080,height:1920}});await baseline.goto('http://127.0.0.1:8130/scripts/video/p2-v42.html');await baseline.waitForFunction(()=>window.ready);await baseline.evaluate(()=>document.fonts.ready);
 const times=[0,.7,1.7,3.95,4.8,6.7,8.8,12.5,14.5,18.9,20.5,22.5,24.9,26.5,27.8,28.9];const differences=[];
 for(const t of times){await baseline.evaluate(t=>window.renderFrame(t),t);await page.evaluate(t=>window.renderFrame(t),t);const a=await baseline.screenshot({type:'png'}),b=await page.screenshot({type:'png'});if(!a.equals(b)){differences.push(t);fs.writeFileSync(`${dir}/regression-old-${t}.png`,a);fs.writeFileSync(`${dir}/regression-new-${t}.png`,b);}}
 fs.writeFileSync(`${dir}/regression.json`,JSON.stringify({times,differences,comparison:'lossless PNG byte equality against unchanged V4.2 HTML'},null,2));await baseline.close();execFileSync('python',['scripts/video/check-post-regression.py',dir],{stdio:'inherit'});
 const issues=new Map();for(let i=0;i<frames;i++){const t=i/30;for(const issue of await page.evaluate(t=>window.audit(t),t))if(!issues.has(issue))issues.set(issue,t);}
 fs.writeFileSync(`${dir}/layout-audit.json`,JSON.stringify({samples:frames,issues:[...issues],checks:['horizontal text overflow','active reading cue bounds','settled outro text bounds']},null,2));if(issues.size)throw Error(JSON.stringify([...issues]));
 for(const t of [27.8,28.9,29.15,29.45,29.9,30.5,31.25]){await page.evaluate(t=>window.renderFrame(t),t);await page.screenshot({path:`${dir}/still-${t}.png`});}
 fs.writeFileSync(`${dir}/render.json`,JSON.stringify(spec,null,2));
 if(process.argv.includes('--stills')){console.log(JSON.stringify({regression:'pass',audit:'pass',...spec}));}else{
 const ff=spawn('C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe',['-y','-loglevel','error','-f','image2pipe','-framerate','30','-c:v','mjpeg','-i','-','-i','docs/p2-v4.2/narration.wav','-map','0:v','-map','1:a','-af',`apad=whole_dur=${spec.duration}`,'-c:v','libx264','-pix_fmt','yuv420p','-crf','17','-c:a','aac','-b:a','160k','-t',String(spec.duration),'-movflags','+faststart','outputs/p2-v4.2-outro.mp4'],{stdio:['pipe','inherit','inherit']});
 const done=new Promise((resolve,reject)=>{ff.on('close',resolve);ff.on('error',reject)});for(let i=0;i<frames;i++){await page.evaluate(t=>window.renderFrame(t),i/30);const image=await page.screenshot({type:'jpeg',quality:93});if(!ff.stdin.write(image))await new Promise(r=>ff.stdin.once('drain',r));if(i%150===0)console.log(`${i}/${frames} frames`);}ff.stdin.end();if(await done!==0)throw Error('ffmpeg failed');console.log(`outputs/p2-v4.2-outro.mp4 / ${spec.duration}s`);
 if(JSON.parse(fs.readFileSync('scripts/video/episodes/p2-v42-outro.json','utf8')).soundEffects?.length)execFileSync('python',['scripts/video/add-p2-answer-sfx.py'],{stdio:'inherit'});
 if(JSON.parse(fs.readFileSync('scripts/video/episodes/p2-v42-outro.json','utf8')).music)execFileSync('python',['scripts/video/add-p2-music.py'],{stdio:'inherit'});
 }
}finally{await browser?.close();server.close();}
