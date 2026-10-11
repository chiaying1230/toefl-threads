import fs from 'node:fs';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL('C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const root='docs/p2-v4.2';
const server=http.createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<body style="margin:0"><video controls style="height:100vh" src="/video.mp4"></video></body>');}
 else if(req.url==='/video.mp4'){res.setHeader('Content-Type','video/mp4');fs.createReadStream(`${root}/p2-v4.2.mp4`).pipe(res);}
 else res.writeHead(404).end();
}).listen(8129,'127.0.0.1');
let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:420,height:780}});await page.goto('http://127.0.0.1:8129');
 const result=await page.evaluate(async()=>{
  const v=document.querySelector('video');let frames=0;const samples=[];
  const callback=(now,meta)=>{frames++;if(!samples.length||meta.mediaTime-samples.at(-1)>1)samples.push(meta.mediaTime);if(!v.ended)v.requestVideoFrameCallback(callback)};
  v.requestVideoFrameCallback(callback);await v.play();await new Promise((resolve,reject)=>{v.onended=resolve;v.onerror=()=>reject(Error('video playback error'));setTimeout(()=>reject(Error('playback timeout')),45000)});
  return {ended:v.ended,currentTime:v.currentTime,duration:v.duration,muted:v.muted,volume:v.volume,presentedFrameCallbacks:frames,samples,error:v.error?.message??null,quality:v.getVideoPlaybackQuality().toJSON?.()??{total:v.getVideoPlaybackQuality().totalVideoFrames,dropped:v.getVideoPlaybackQuality().droppedVideoFrames}};
 });
 result.review='Full real-time browser playback completed with audio enabled. Automation has no audio-perception channel; no claim of listening verification.';
 fs.writeFileSync(`${root}/playback-verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();server.close();}
