import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import Tesseract from 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.esm.min.js';
import {readingOrder,reconstruct,searchPassages} from './layout.mjs';
const cdn='https://cdn.jsdelivr.net/npm/';
pdfjs.GlobalWorkerOptions.workerSrc=cdn+'pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const el=id=>document.getElementById(id);
const status=message=>{el('status').textContent=message;};
const make=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
let pdf, passages=[], previewRevision=0;
const preview=el('preview');

async function renderPage(page, canvas, scale) {
  const viewport=page.getViewport({scale});
  canvas.width=Math.ceil(viewport.width);
  canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
}
async function show(p) {
  const revision=++previewRevision;
  el('location').textContent='Opening page '+p.page+'…';
  const canvas=document.createElement('canvas');
  try {
    await renderPage(await pdf.getPage(p.page),canvas,p.scale);
    if(revision!==previewRevision)return;
    preview.width=canvas.width;
    preview.height=canvas.height;
    const context=preview.getContext('2d'), {x0,y0,x1,y1}=p.box;
    context.drawImage(canvas,0,0);
    context.fillStyle='#ffb00045';
    context.fillRect(x0,y0,x1-x0,y1-y0);
    context.strokeStyle='#a44500';
    context.lineWidth=4;
    context.strokeRect(x0,y0,x1-x0,y1-y0);
    el('location').textContent='Page '+p.page+' · selected passage highlighted';
  } catch {
    if(revision===previewRevision)el('location').textContent='Could not display this page.';
  }
}
function jump(p) {
  const target=el(p.id);
  target.focus();
  target.scrollIntoView({block:'center'});
  void show(p);
}
function addPassage(p) {
  const article=make('article','');
  article.id=p.id;
  article.className='passage';
  article.tabIndex=-1;
  const text=make(p.heading?'h3':'p',p.text);
  article.append(text);
  if(p.confidence<82){
    const note=make('p','Check this text against the scan.');
    note.className='note';
    article.append(note);
  }
  const locate=make('button','Show on page '+p.page);
  locate.onclick=()=>void show(p);
  const copy=make('button','Copy passage');
  copy.onclick=async()=>{
    try { await navigator.clipboard.writeText(p.text); copy.textContent='Copied'; }
    catch { copy.textContent='Select and copy the passage above'; }
  };
  const edit=make('details','');
  const label=make('label','Correct passage text');
  const input=make('textarea','');
  input.value=p.text;
  label.append(input);
  const save=make('button','Apply correction');
  save.onclick=()=>{
    if(!input.value.trim())return;
    p.text=input.value.trim();
    text.textContent=p.text;
    copy.textContent='Copy passage';
    if(outlineLink)outlineLink.textContent=p.text;
    if(!el('results').hidden)runSearch(false);
    edit.open=false;
    locate.focus();
  };
  edit.append(make('summary','Correct text'),label,save);
  article.append(locate,' ',copy,edit);
  el('transcript').append(article);
  let outlineLink;
  if(p.heading){
    outlineLink=make('a',p.text);
    outlineLink.href='#'+p.id;
    outlineLink.onclick=event=>{event.preventDefault();jump(p);};
    const item=make('li','');
    item.append(outlineLink);
    el('outline').append(item);
  }
}
function runSearch(focus=true){
  const hits=searchPassages(passages,el('query').value);
  el('matches').replaceChildren();
  for(const p of hits){
    const item=make('li','');
    const button=make('button','Page '+p.page+' · '+p.text.slice(0,155)+(p.text.length>155?'…':''));
    button.onclick=()=>jump(p);
    item.append(button);
    el('matches').append(item);
  }
  el('results-title').textContent=hits.length?hits.length+' matching passages':'No matching passages';
  el('results').hidden=false;
  if(focus)el('results-title').focus();
}
el('search').onsubmit=event=>{event.preventDefault();runSearch();};
el('export').onclick=()=>{
  const url=URL.createObjectURL(new Blob([passages.map(p=>p.text).join('\n\n')],{type:'text/plain;charset=utf-8'}));
  const a=make('a','');a.href=url;a.download='transcript.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
async function read(load) {
  el('reader').hidden=true;
  el('file').disabled=el('example').disabled=el('nasa').disabled=true;
  previewRevision++;
  preview.width=0;
  el('location').textContent='Select a passage to see it on the page.';
  status('Opening PDF and loading the English OCR model…');
  let worker;
  try{
    await pdf?.destroy();pdf=null;
    pdf=await pdfjs.getDocument({data:await load(),isEvalSupported:false}).promise;
    if(pdf.numPages>30)throw Error('Choose a PDF with 30 pages or fewer.');
    worker=await Tesseract.createWorker('eng',1,{workerPath:cdn+'tesseract.js@6.0.1/dist/worker.min.js',corePath:cdn+'tesseract.js-core@6.0.0',langPath:'https://tessdata.projectnaptha.com/4.0.0_fast'});
    passages=[];
    const canvas=document.createElement('canvas');
    for(let number=1;number<=pdf.numPages;number++){
      status('Reading page '+number+' of '+pdf.numPages+'…');
      const page=await pdf.getPage(number);
      const size=page.getViewport({scale:1});
      const scale=Math.min(3,2200/Math.max(size.width,size.height));
      await renderPage(page,canvas,scale);
      const {data}=await worker.recognize(canvas,{}, {blocks:true});
      const blocks=reconstruct(data.blocks||[],canvas.width);
      const heights=blocks.map(p=>p.lineHeight).sort((a,b)=>a-b);
      const median=heights[Math.floor(heights.length/2)]||0;
      passages.push(...readingOrder(blocks,canvas.width).map((p,i)=>({
        ...p,page:number,scale,id:'page-'+number+'-passage-'+(i+1),
        heading:p.lineCount===1 && p.text.length<=95 && p.lineHeight>median*1.18
      })));
    }
    el('transcript').replaceChildren();
    el('outline').replaceChildren();
    el('results').hidden=true;
    el('query').value='';
    passages.forEach(addPassage);
    el('reader').hidden=!passages.length;
    status(passages.length?pdf.numPages+' pages ready. Search for a phrase or read the transcript.':'No readable text found in this PDF.');
  }catch(error){status('Could not read the PDF. '+error.message);}
  finally{try{await worker?.terminate();}finally{el('file').disabled=el('example').disabled=el('nasa').disabled=false;}}
}
el('file').onchange=event=>{const file=event.target.files[0];if(file)void read(()=>file.arrayBuffer());};
function openExample(name){return read(async()=>{
  const response=await fetch('examples/'+name);
  if(!response.ok)throw Error('The example is unavailable.');
  return response.arrayBuffer();
});}
el('example').onclick=()=>void openExample('water-cycle.pdf');
el('nasa').onclick=()=>void openExample('nasa-source.pdf');
