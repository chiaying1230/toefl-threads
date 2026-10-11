// Loopback-only preview, restricted to this prototype's outputs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('docs/p2-v4.2');
http.createServer((req,res)=>{
 const name=decodeURIComponent(req.url.split('?')[0]).slice(1);
 if(!['p2-v4.2.mp4','sheet-review.png','sheet-timeline.png'].includes(name)){res.writeHead(404).end();return;}
 const p=path.join(root,name);res.writeHead(200,{'Content-Type':name.endsWith('.mp4')?'video/mp4':'image/png'});fs.createReadStream(p).pipe(res);
}).listen(8128,'127.0.0.1');
