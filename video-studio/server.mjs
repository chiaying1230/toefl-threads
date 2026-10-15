import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { loadCatalog, candidates, suggestions } from './catalog.mjs';
import { seriesProgress } from './series-progress.mjs';
import { correctSeriesEpisode } from './series-correction.mjs';
import { videoLibrary,setVideoUploaded } from './video-library.mjs';
import { BatchProduction } from './batch-production.mjs';
import { DraftStore, StudioError } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { ProductionService } from './production.mjs';
import { productionProposal } from './production-decisions.mjs';
import { sourceSentences, TIMINGS_ID } from './compiler.mjs';
import { sourceTranslations, fillMissingSourceTranslations } from './source-translation.mjs';
import { sourceDisplayCandidates } from './source-display.mjs';
import { jsonHash } from './hashing.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.dirname(here);
export function createStudio({ stateDir = path.join(here, 'state/drafts'), productionDir = path.join(stateDir, 'production'), catalogLoader = loadCatalog, fetchImpl, apiKey, promotion = { enabled: false }, log = () => {} } = {}) {
  // Keep the loaded-code identity from startup, but never share mutation catalog snapshots.
  const loadedEngineHash = new ProductionWorkflow(new DraftStore(stateDir, catalogLoader(root)), root).loadedEngineHash;
  // One executing coordinator per state directory (OS lifetime lock); restart recovery runs here, before any request.
  const production = new ProductionService({ draftsDir: stateDir, productionDir, repoRoot: root, catalogLoader, loadedEngineHash, fetchImpl, apiKey, promotion, log });
  const batches=new BatchProduction(production);
  const csrf = randomBytes(24).toString('hex');
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value));
    try {
      // Loopback-only plus Host/Origin checks prevent cross-site requests and DNS rebinding.
      const address = server.address();
      const allowed = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
      if (!allowed.includes(req.headers.host) || (req.headers.origin && !allowed.map(h => `http://${h}`).includes(req.headers.origin))) throw new StudioError('Forbidden origin', 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      let input;
      if (['POST', 'PUT'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new StudioError('JSON required', 415);
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 32768) throw new StudioError('Request too large', 413); }
        try { input = JSON.parse(body); } catch { throw new StudioError('Invalid JSON'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StudioError('JSON object required');
      }
      if (req.method === 'GET' && url.pathname === '/api/session') return send(200, { csrf, capabilityProfile: '2B', promotionEnabled: promotion.enabled === true });
      if(url.pathname==='/api/batches'&&req.method==='GET')return send(200,{batches:batches.list().map(b=>batches.view(b.id))});
      if(url.pathname==='/api/batches'&&req.method==='POST'){if(req.headers['x-studio-csrf']!==csrf)throw new StudioError('Forbidden request',403);return send(201,await batches.prepare(input));}
      const startBatch=url.pathname.match(/^\/api\/batches\/([a-f0-9-]{36})\/start$/);
      if(startBatch&&req.method==='POST'){if(req.headers['x-studio-csrf']!==csrf)throw new StudioError('Forbidden request',403);return send(200,batches.start(startBatch[1],input));}
      // No awaits between this fresh, request-local context and the synchronous mutation.
      const catalog = url.pathname.startsWith('/api/') ? catalogLoader(root) : null;
      const store = catalog ? new DraftStore(stateDir, catalog) : null;
      const workflow = store ? new ProductionWorkflow(store, root, { loadedEngineHash }) : null;
      if (req.method === 'GET' && url.pathname === '/api/contents') return send(200, { contents: [...catalog.records.values()].map(r => ({ id: r.post.id, pack: r.pack, topic: r.post.topic, excerpt: r.post.text.slice(0, 150), frozen: catalog.frozen.has(r.post.id) })) });
      if (req.method === 'GET' && url.pathname === '/api/series-progress') return send(200,{series:seriesProgress(root,store.list())});
      if (req.method === 'GET' && url.pathname === '/api/video-library') return send(200,{videos:videoLibrary(root,productionDir)});
      const uploadStatus=url.pathname.match(/^\/api\/video-library\/([a-z0-9-]+)\/upload-status$/);
      if(req.method==='POST'&&uploadStatus){if(req.headers['x-studio-csrf']!==csrf)throw new StudioError('Forbidden request',403);return send(200,{video:setVideoUploaded(root,productionDir,uploadStatus[1],input.uploaded)});}
      const savedVideo=url.pathname.match(/^\/api\/video-library\/([a-z0-9-]+)\/final$/);
      if(req.method==='GET'&&savedVideo){const item=videoLibrary(root,productionDir,savedVideo[1])[0];if(!item)throw new StudioError('找不到這個已保存影片。',404);return streamMedia(req,res,{file:item.file,contentType:'video/mp4',etag:item.etag,...(url.searchParams.get('download')==='1'?{downloadName:path.basename(item.file)}:{})});}
      if (req.method === 'GET' && url.pathname.startsWith('/api/contents/')) {
        const record = catalog.records.get(decodeURIComponent(url.pathname.slice(14)));
        if (!record) throw new StudioError('Unknown content', 404);
        const sentences = sourceSentences(record);
        const subtitleSentences = sourceSentences(record, [], { mode: 'subtitle', seconds: 2 });
        const translations = sourceTranslations(record);
        const proposed=suggestions(root,record),progress=seriesProgress(root,store.list());
        return send(200, { record, candidates: candidates(record, catalog.vocab), suggestions: {...proposed,seriesEpisode:progress[proposed.series].nextEpisode}, seriesProgress:progress, frozen: catalog.frozen.has(record.post.id), sentences, subtitleSentences, subtitleProposal: productionProposal(record, null, subtitleSentences, sourceTranslations(record, { subtitle: true })), displayOnlyCandidates: sourceDisplayCandidates(record), productionProposal: productionProposal(record, null, sentences, translations), timingsVersion: TIMINGS_ID });
      }
      if (url.pathname === '/api/drafts' && req.method === 'GET') return send(200, { drafts: store.list().map(d => workflow.reconcile(d.id)) });
      if (url.pathname === '/api/drafts' && req.method === 'POST') {
        const created=store.create(input.contentId,input.sourceHash),proposed=suggestions(root,catalog.records.get(created.contentId));
        created.decisions.series=proposed.series;
        created.decisions.seriesEpisode=seriesProgress(root,store.list())[proposed.series].nextEpisode;
        return send(201,store.persist(created));
      }
      if (url.pathname.startsWith('/api/drafts/')) {
        const numbering=url.pathname.match(/^\/api\/drafts\/([a-f0-9-]{36})\/series-episode$/);
        if(numbering&&req.method==='POST')return send(200,correctSeriesEpisode(store,numbering[1],input));
        const p2 = url.pathname.match(/^\/api\/drafts\/([a-f0-9-]{36})\/production(?:\/([a-z-]+))?(?:\/([a-z0-9-]+))?$/);
        if (p2) {
          const [, id, action, arg] = p2;
          if (req.method === 'GET' && !action) return send(200, production.view(id));
          if (req.method === 'GET' && action === 'media') { const media = production.media(id, arg); if (arg === 'final' && url.searchParams.get('download') === '1') media.downloadName = path.basename(media.file); return streamMedia(req, res, media); }
          if (req.method === 'GET' && action === 'result') {
            const view = production.view(id);
            if (!view.readiness.productionReady || view.review?.status !== 'accepted') throw new StudioError('這個版本尚未完成驗收。', 409);
            const media = production.media(id, 'final');
            return send(200, { runId: view.run.runId, fileName: path.basename(media.file), savedPath: media.file, bytes: fs.statSync(media.file).size, completedAt: view.review.receipt?.decidedAt || null });
          }
          if (req.method !== 'POST') throw new StudioError('Unsupported production operation', 405);
          if(batches.busy&&action!=='review')throw new StudioError('批次正在製作，請稍候再單獨產生語音或重建。',409);
          // paid / review / promotion transitions: same-origin page token on top of Host / Origin checks
          if (req.headers['x-studio-csrf'] !== csrf) throw new StudioError('Missing / invalid Studio session token', 403);
          if (action === 'preview') return send(200, await production.preview(id, { revision: input.revision, recoveryRunId: input.recoveryRunId || null }));
          if (action === 'confirm') return send(200, await production.confirm(id, input));
          if (action === 'retake') return send(200, await production.retake(id, input));
          if (action === 'select-take') return send(200, await production.selectTake(id, input));
          if (action === 'restore-take') return send(200, production.restoreTake(id, input));
          if (action === 'rebuild-after-update') return send(200, await production.rebuildAfterUpdate(id, input));
          if (action === 'resume') return send(200, production.resume(id, input.runId));
          if (action === 'resume-voice') return send(200, production.resumeVoice(id, input.runId));
          if (action === 'review') return send(200, production.decideReview(id, input));
          if (action === 'promotion' && arg === 'preview') return send(200, production.promotionPreview(id));
          if (action === 'promotion' && arg === 'confirm') return send(200, production.promote(id, input));
          throw new StudioError('Unsupported production operation', 405);
        }
        const operation = url.pathname.match(/^\/api\/drafts\/([a-f0-9-]{36})\/(workflow|artifacts)(?:\/([a-zA-Z]+))?$/);
        if (operation) {
          const [, id, type, name] = operation;
          if (type === 'workflow' && !name && req.method === 'POST') return send(200, workflow.run(id, input));
          if (type === 'artifacts' && req.method === 'GET' && ['narration', 'episode', 'compileReport', 'validation', 'voicePlan'].includes(name)) return send(200, workflow.read(workflow.reconcile(id), name));
          throw new StudioError('Unsupported workflow operation', 405);
        }
        const id = url.pathname.slice(12);
        if (req.method === 'GET') return send(200, workflow.reconcile(id));
        if (req.method === 'PUT') {
          // validate first (no side effect), then record the mutation intent: old receipts / runs / approvals are revoked BEFORE
          // the new revision is written; a crash in between leaves `pending`, which blocks paid transitions until recovered.
          const current = workflow.reconcile(id);
          const record = catalog.records.get(current.contentId);
          try { input.decisions = fillMissingSourceTranslations(record, input.decisions); }
          catch (e) { throw new StudioError(e.message); }
          const unchanged = store.update(id, input, { dryRun: true });
          if (unchanged) return send(200, unchanged);
          const mutation = production.beginMutation(id, current.revision, jsonHash(current.decisions));
          try { const saved = store.update(id, input); production.finishMutation(mutation, true); return send(200, saved); }
          catch (e) { production.finishMutation(mutation, false); throw e; }
        }
      }
      if (req.method !== 'GET') throw new StudioError('Unsupported operation', 405);
      const files = { '/': ['index.html', 'text/html'], '/batch':['batch.html','text/html'], '/batch.js':['batch.js','text/javascript'], '/videos': ['videos.html', 'text/html'], '/videos.js': ['videos.js', 'text/javascript'], '/videos.css': ['videos.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/wizard.js': ['wizard.js', 'text/javascript'], '/production.js': ['production.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      files['/studio-cover.png'] = ['studio-cover.png', 'image/png'];
      files['/studio.ico'] = ['studio-tofu.ico', 'image/x-icon'];
      files['/studio-brand.css'] = ['studio-brand.css', 'text/css'];
      const file = files[url.pathname];
      if (!file) throw new StudioError('Not found', 404);
      res.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8`, 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' }).end(fs.readFileSync(path.join(here, 'public', file[0])));
    } catch (e) { if (!res.headersSent) send(e.status || 500, { error: { code: e.status || 500, message: e.status ? e.message : 'Studio internal error; see server log', problems: e.problems } }); if (!e.status) console.error(e); }
  });
  server.production = production;
  server.batches=batches;
  server.on('close', () => production.close());
  return server;
}
/** Range-capable streaming of ONE authorized, hash-verified artifact (never a path from the client). */
function streamMedia(req, res, media) {
  const size = fs.statSync(media.file).size, range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const headers = { 'content-type': media.contentType, 'accept-ranges': 'bytes', etag: `"${media.etag}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (media.downloadName) headers['content-disposition'] = `attachment; filename="${media.downloadName.replace(/[^A-Za-z0-9._-]/g, '_')}"`;
  if (range) {
    let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]), end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : size - 1;
    if (!(start >= 0 && end < size && start <= end)) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    fs.createReadStream(media.file, { start, end }).pipe(res);
  } else { res.writeHead(200, { ...headers, 'content-length': size }); fs.createReadStream(media.file).pipe(res); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createStudio({ promotion: { enabled: process.argv.includes('--enable-promotion') }, log: m => console.log(m) });
  server.listen(Number(process.env.VIDEO_STUDIO_PORT || 8140), '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    console.log(`Video Studio: ${url}`);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      const opener = spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
      opener.on('error', () => console.error(`Open ${url} in your browser.`));
    }
  });
}
