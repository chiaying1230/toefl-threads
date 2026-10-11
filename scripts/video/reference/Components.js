// Presentation only. All episode copy, target words and answer indexes come from JSON.
export function node(tag,className,text,id){const e=document.createElement(tag);if(className)e.className=className;if(text!=null)e.textContent=text;if(id)e.id=id;return e;}
function lines(e,text){text.forEach((s,i)=>{if(i)e.append(document.createElement('br'));e.append(document.createTextNode(s));});return e;}
export function createHook(data){
 const root=node('section',null,null,data.id),number=node('div','hooknum',data.number),boxes=lines(node('div','hookbox'),data.payoff),emoji=node('span','boxemoji',data.emoji),bar=node('div','bar'),fill=node('i');
 fill.style.width=100*data.ratio+'%';bar.append(fill);boxes.append(emoji);
 root.append(node('div','eyebrow',data.label),number,node('div','hooksub',data.caption),bar,boxes,node('div','zh',data.zh));return {el:root,number,boxes,emoji};
}
export function createVocabulary(data,reading){
 const root=node('div','note'+(data.memory?' memoryNote':''),null,data.id),inner=node('div','noteInner');
 if(data.memory){const m=node('div','memory');m.append(node('small',null,data.memory.label),document.createTextNode(data.memory.text));inner.append(m);}
 const meaning=node('div','meaning voicezh',data.word+' · '+data.zh);meaning.dataset.voice=data.meaningLine;meaning.append(node('span','pos',data.pos));
 inner.append(meaning,reading(data.exampleLine,'example'),node('div','exzh',data.exampleZh));root.append(inner);return {el:root,inner,meaning};
}
export function createQuiz(data){
 const root=node('section','reply',null,data.id);root.append(node('div','replymeta',data.meta),lines(node('div','quote'),data.quote));
 const question=node('div','question');if(data.word)question.append(node('b',null,data.word));question.append(document.createTextNode(data.question));root.append(question);
 const options=node('div','options');const rows=data.options.map((text,i)=>{const row=node('div','option');row.append(node('small',null,String.fromCharCode(65+i)),document.createTextNode(text));options.append(row);return row;});
 const timer=node('div','think'),bar=node('i');timer.append(bar);const feedback=node('div','feedback',data.feedback);feedback.append(node('small',null,data.feedbackDetail));root.append(options,timer,feedback);
 return {el:root,update(t,q,a,clamp){const thinking=t>=q.end&&t<a.start;bar.style.width=100*(1-clamp((t-q.end)/(a.start-q.end)))+'%';timer.style.opacity=thinking?1:0;rows.forEach((r,i)=>{r.classList.toggle('correct',i===data.answer&&t>=a.start);r.classList.toggle('wrong',i!==data.answer&&t>=a.start);});feedback.style.opacity=t>=a.start?1:0;}};
}
export function createOutro(data,art){
 const root=node('section','reply outro',null,data.id),author=node('div','outro-author'),mascot=node('div','outro-mascot'),title=node('div','outro-account',data.author);
 if(data.mascot?.enabled){mascot.innerHTML=art;author.append(mascot);}author.append(title);
 const cta=node('div','outro-cta',data.cta),bookmark=node('span','bookmark');bookmark.setAttribute('aria-hidden','true');cta.prepend(bookmark);
 const words=node('div','outro-words');for(const word of data.words){const row=node('div','outro-word');row.append(node('b',null,word.en),node('span',null,word.zh));words.append(row);}
 root.append(author,node('div','outro-lead',data.lead),words,cta,node('div','outro-brand',data.brandLine));
 return {el:root,update(t,start,ramp){const p=ramp(t,start+data.scrollDuration,data.mascot?.cueDuration??.65);mascot.style.transform=`rotate(${-5*Math.sin(p*Math.PI)}deg)`;mascot.querySelectorAll('.pupil,.shine').forEach(e=>e.style.transform=`translate(${p*.8}px,${p*1.2}px)`);mascot.style.visibility=t>=start&&t<start+data.scrollDuration+(data.mascot?.cueDuration??.65)+.45?'visible':'hidden';bookmark.style.setProperty('--saved',ramp(t,start+data.scrollDuration+.25,.25));}};
}
