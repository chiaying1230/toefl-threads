import {createReadingLine} from './ReadingCue.js';
import {isPhrase,phrasePatterns,annotatePhrases} from './Phrase.js';
import {usesSeriesHeader,headerLabel} from './Header.js';
import {node,createHook,createVocabulary,createQuiz,createOutro} from './Components.js';
const clamp=x=>Math.max(0,Math.min(1,x)),ease=x=>{x=clamp(x);return x*x*(3-2*x)},ramp=(t,s,d=.28)=>ease((t-s)/d);
export async function mountPostTemplate(data,plan){
 const byLine=new Map(plan.lines.map(l=>[l.id,l]));const line=id=>{if(!byLine.has(id))throw Error('Missing alignment line: '+id);return byLine.get(id);};
 const time=ref=>{if(typeof ref==='number')return ref;if(ref==='planEnd')return plan.duration;const l=line(ref.line);if(ref.word){const w=l.words.find(w=>w.text.replace(/[.,]/g,'').toLowerCase()===ref.word.toLowerCase());if(!w)throw Error('Missing aligned target: '+ref.word);return l.start+w.at+(ref.delay??0);}return (ref.edge==='end'?l.end:l.start)+(ref.delay??0);};
 const $=id=>document.getElementById(id),stage=$('stage'),brand=node('div',null,null,'brand');const series=usesSeriesHeader(data);brand.append(node('span',null,data.brand),node('span',null,series?headerLabel(data):data.episodeLabel));
 const surface=node('article',null,null,'window'),account=node('div',null,null,'account'),name=node('div');name.append(node('div','name',data.author.name),node('div','meta',data.author.meta));account.append(node('div','avatar',data.author.avatar),name);if(!series)account.append(node('div','level',data.author.level));
 const view=node('div',null,null,'view'),thread=node('div',null,null,'thread');view.append(thread);const social=node('div',null,null,'social'),status=node('strong',null,null,'status');social.append(node('span',null,data.social),status);surface.append(account,view,social);
 const outside=node('div',null,null,'outside'),phase=node('span',null,null,'phase');outside.append(node('span',null,data.outside),phase);stage.append(brand,surface,outside);
 const reading=[];const terms=data.vocabulary.flatMap(v=>[v.word,...v.forms??[]]),phrases=phrasePatterns(terms),keys=new Set(terms.filter(w=>!isPhrase(w)).map(w=>w.toLowerCase())),events=new Set(data.readingEvents??[]);
 const read=(id,className)=>{const api=createReadingLine(line(id),className,keys,events);if(phrases.length)annotatePhrases(api.el,phrases);reading.push(api);return api.el;};
 const hook=createHook(data.hook);thread.append(hook.el);const notes=[];
 for(const block of data.story){const section=node('section','source',null,block.id);for(const part of block.parts){
  if(part.type==='reading')section.append(read(part.line,'paragraph'));
  else if(part.type==='translation')section.append(node('div','zh',part.text));
  else if(part.type==='vocabulary'){const v=data.vocabulary.find(v=>v.id===part.id);if(!v)throw Error('Missing vocabulary: '+part.id);const api=createVocabulary(v,read);notes.push({api,data:v,open:time(v.open),close:time(v.close)});section.append(api.el);}
  else if(part.type==='reaction')section.append(node('div','reaction',part.text,part.id));
  else if(part.type==='illustration'&&part.kind==='pen'){const desk=node('div','desk',null,part.id);desk.append(node('div','deskline'),node('div','pen'),node('div','paw','🐾'));section.append(desk);}
  else throw Error('Unsupported story part: '+part.type);
 }thread.append(section);}
 const quiz=createQuiz(data.quiz);thread.append(quiz.el);
 let outro=null,start=Infinity;if(data.outro){start=time(data.outro.start);const source=await(await fetch('/scripts/video/components/Mascot.js')).text();const art=source.match(/const SVG = `([\s\S]*?)`;/)?.[1];if(!art)throw Error('Existing tofu artwork missing');outro=createOutro(data.outro,art.replaceAll('id="','data-original-id="'));thread.append(outro.el);}
 const camera=data.camera.map(c=>({...c,at:time(c.at)}));if(outro)camera.push({at:start,id:data.outro.id,offset:data.outro.offset,duration:data.outro.scrollDuration});
 const visible=data.visibility.map(v=>({...v,at:time(v.at)}));notes.forEach(n=>n.height=n.api.inner.offsetHeight);
 // Camera vs. vocabulary notes: a note opening / closing moves every section below it. If such an animation overlaps a camera move, a live target
 // makes the camera chase the moving section (overshoot, then back). So that move runs between two constants: the layout when it starts, and the
 // layout once the overlapping animations are over (cam.settle). A move that overlaps no animation keeps the plain live formula.
 const setNotes=time=>{for(const n of notes)n.api.el.style.height=n.height*(ramp(time,n.open,n.data.openDuration)-ramp(time,n.close,n.data.closeDuration))+'px';};
 const windows=notes.flatMap(n=>[[n.open,n.open+n.data.openDuration],[n.close,n.close+n.data.closeDuration]]);
 camera.forEach(c=>{c.duration=c.duration??data.scrollDuration;let end=c.at+c.duration,grew=true;while(grew){grew=false;for(const[s,e]of windows)if(s<end&&e>c.at&&e>end){end=e;grew=true;}}c.settle=end;});
 const reveal=time(data.hook.reveal),q=line(data.quiz.questionLine),answer=line(data.quiz.answerLine);
 function render(t){
  for(const n of notes){n.api.el.style.height=n.height*(ramp(t,n.open,n.data.openDuration)-ramp(t,n.close,n.data.closeDuration))+'px';const meaning=line(n.data.meaningLine);n.api.meaning.classList.toggle('active',t>=meaning.start&&t<meaning.end);}
  reading.forEach(r=>r.update(t));hook.update(t,reveal,data.hook.revealDuration,ramp);
  let target=0,previous=0,at=0,duration=data.scrollDuration,cam=null,ci=-1;for(let i=0;i<camera.length;i++){const c=camera[i];if(t<c.at)break;previous=i>0?Math.max(0,$(camera[i-1].id).offsetTop-camera[i-1].offset):0;target=Math.max(0,$(c.id).offsetTop-c.offset);at=c.at;duration=c.duration??data.scrollDuration;cam=c;ci=i;}
  if(cam&&cam.settle>cam.at+cam.duration&&t<cam.settle){setNotes(cam.at);previous=ci>0?Math.max(0,$(camera[ci-1].id).offsetTop-camera[ci-1].offset):0;setNotes(cam.settle);target=Math.max(0,$(cam.id).offsetTop-cam.offset);setNotes(t);}
  thread.style.transform=`translateY(${-previous-(target-previous)*ramp(t,at,duration)}px)`;visible.forEach(v=>$(v.id).style.opacity=t>=v.at?1:v.before);
  if(data.reaction?.kind==='pen'){const r=data.reaction,p=line(r.line),knock=time({line:r.line,word:r.word}),fall=ramp(t,knock+.2,.38),el=$(r.id);el.querySelector('.pen').style.transform=`translate(${fall*65}px,${fall*67}px) rotate(${fall*32}deg)`;el.querySelector('.paw').style.transform=`translateX(${ramp(t,knock,.16)*(1-ramp(t,knock+.3,.25))*75}px)`;$(r.captionId).style.opacity=t>=time(r.captionAt)?1:0;}
  quiz.update(t,q,answer,clamp);const thinking=t>=q.end&&t<answer.start;
  status.textContent=t>=q.start?(t>=answer.start?data.status.answer:data.status.question):data.status.reading;phase.textContent=thinking?data.status.thinkingPhase:t>=answer.start?data.status.answerPhase:t>=q.start?data.status.thinkingPhase:data.status.readingPhase;
  if(outro){outro.el.style.visibility=t>=start?'visible':'hidden';outro.update(t,start,ramp);if(t>=start){status.textContent=data.outro.status;phase.textContent=data.outro.phase;}}
 }
 function audit(t){render(t);const issues=[];for(const e of stage.querySelectorAll('.paragraph,.meaning,.example,.exzh,.question,.option,.quote,.feedback,.outro-cta,.outro-word,.outro-lead,.outro-brand')){if(e.scrollWidth>e.clientWidth+2)issues.push('horizontal overflow: '+(e.dataset.line||e.className));}
  const bounds=view.getBoundingClientRect();for(const e of stage.querySelectorAll('.cue.active,.voicezh.active')){const r=e.getBoundingClientRect();if(r.top<bounds.top+8||r.bottom>bounds.bottom-10)issues.push('active cue clipped: '+e.textContent);}
  if(outro&&t>=start+data.outro.scrollDuration){for(const e of outro.el.querySelectorAll('.outro-cta,.outro-word,.outro-brand')){const r=e.getBoundingClientRect();if(r.top<bounds.top+8||r.bottom>bounds.bottom-10)issues.push('outro clipped: '+e.className);}}
  return issues;
 }
 const duration=outro?start+data.outro.duration:plan.duration;render(0);return {render,audit,duration,start,plan,time};
}
