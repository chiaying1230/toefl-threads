// Character-position observations are used unchanged; never interpolate word times.
export function createReadingLine(line, className, vocabulary, events) {
  const root=document.createElement('div');root.className=className;root.dataset.line=line.id;
  const tokens=[];
  for(const match of line.text.matchAll(/\S+/g)){
    const word=match[0].replace(/[.,]/g,'').toLowerCase();
    const span=document.createElement('span');span.className='cue'+(vocabulary.has(word)?' key':'')+(events.has(word)?' event':'');
    span.textContent=match[0];span.dataset.pos=match.index;
    const observed=line.words.filter(w=>w.pos>=match.index&&w.pos<match.index+match[0].length);
    tokens.push({span,start:observed[0]?.at??0,end:observed.at(-1)?.until??line.duration});
    root.append(span,document.createTextNode(' '));
  }
  return {el:root,update(t){const local=t-line.start;for(const token of tokens){token.span.classList.toggle('read',local>=token.start);token.span.classList.toggle('active',local>=token.start&&local<token.end);}}};
}
