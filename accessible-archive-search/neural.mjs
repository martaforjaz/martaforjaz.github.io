import {readingOrder} from '../accessible-document-reader/layout.mjs';
const cdn='https://cdn.jsdelivr.net/npm/';
const modelRoot=new URL('./ocr/model/',import.meta.url);
const HEIGHT=32,WIDTH=640;
let network,layoutWorker;
function retryable(load,clear){
  return load().catch(error=>{clear();throw error;});
}
function recognizer(){
  return network??=retryable(async()=>{
    const ort=await import('./ocr/runtime/ort.wasm.min.mjs');
    ort.env.wasm.numThreads=1;
    ort.env.wasm.wasmPaths=new URL('./ocr/runtime/',import.meta.url).href;
    const alphabetResponse=await fetch(new URL('alphabet.json',modelRoot));
    if(!alphabetResponse.ok)throw Error('Character map unavailable.');
    const alphabet=await alphabetResponse.json();
    const session=await ort.InferenceSession.create(new URL('recognizer.onnx',modelRoot).href,{executionProviders:['wasm']});
    return {ort,alphabet,session};
  },()=>{network=null;});
}
function layout(){
  return layoutWorker??=retryable(async()=>{
    const {default:Tesseract}=await import(cdn+'tesseract.js@6.0.1/dist/tesseract.esm.min.js');
    return Tesseract.createWorker('eng',1,{
      workerPath:cdn+'tesseract.js@6.0.1/dist/worker.min.js',
      corePath:cdn+'tesseract.js-core@6.0.0',
      langPath:'https://tessdata.projectnaptha.com/4.0.0_fast'
    });
  },()=>{layoutWorker=null;});
}
function canvas(w,h){
  const node=document.createElement('canvas');
  node.width=w;node.height=h;
  return node;
}
async function lineText(source,{x0,y0,x1,y1},net){
  const w=x1-x0,h=y1-y0;
  const width=Math.min(WIDTH,Math.max(4,Math.round(w*HEIGHT/h)));
  const input=canvas(WIDTH,HEIGHT), ctx=input.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='white';
  ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.drawImage(source,x0,y0,w,h,0,0,width,HEIGHT);
  const rgba=ctx.getImageData(0,0,WIDTH,HEIGHT).data, data=new Float32Array(WIDTH*HEIGHT);
  for(let i=0;i<data.length;i++)data[i]=(rgba[4*i]*.299+rgba[4*i+1]*.587+rgba[4*i+2]*.114)/127.5-1;
  const {logits}=await net.session.run({image:new net.ort.Tensor('float32',data,[1,1,HEIGHT,WIDTH])});
  const classes=logits.dims[2];
  let previous=0,text='';
  for(let t=0;t<Math.floor(width/4);t++){
    let best=0;
    for(let i=1;i<classes;i++)if(logits.data[t*classes+i]>logits.data[t*classes+best])best=i;
    if(best&&best!==previous)text+=net.alphabet[best-1];
    previous=best;
  }
  return text.normalize('NFKC').replace(/\s+/g,' ').trim();
}
function bounded(box,source){
  const pad=Math.max(2,Math.round((box.y1-box.y0)*.14));
  return {x0:Math.max(0,box.x0-pad),y0:Math.max(0,box.y0-pad),
    x1:Math.min(source.width,box.x1+pad),y1:Math.min(source.height,box.y1+pad)};
}
export async function transcribeCanvas(source,{singleLine=false,progress=()=>{}}={}){
  const net=await recognizer();
  let boxes;
  if(singleLine){
    boxes=[{x0:0,y0:0,x1:source.width,y1:source.height}];
  }else{
    const worker=await layout();
    const {data}=await worker.recognize(source,{}, {blocks:true});
    // The layout worker supplies line coordinates in reading order. Only
    // the trained neural recognizer supplies the text shown to the user.
    const lines=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
    const midpoint=source.width/2;
    const split=line=>{
      const words=(line.words||[]).map(word=>word.bbox).sort((a,b)=>a.x0-b.x0);
      const cut=words.findIndex((word,i)=>i>0 && words[i-1].x1<midpoint+source.width*.035 &&
        word.x0>midpoint-source.width*.035 && word.x0-words[i-1].x1>source.width*.045);
      if(cut<1)return null;
      return [words.slice(0,cut),words.slice(cut)].map(group=>({
        x0:Math.min(...group.map(b=>b.x0)),y0:Math.min(...group.map(b=>b.y0)),
        x1:Math.max(...group.map(b=>b.x1)),y1:Math.max(...group.map(b=>b.y1))
      }));
    };
    const columns=lines.filter(split).length>=2;
    const regions=lines.flatMap(line=>columns?(split(line)||[line.bbox]):[line.bbox]);
    boxes=readingOrder(regions.map(box=>({box})),source.width).map(({box})=>bounded(box,source));
  }
  const lines=[];
  for(const box of boxes){
    if(box.x1<=box.x0||box.y1<=box.y0)continue;
    const text=await lineText(source,box,net);
    if(text)lines.push(text);
    progress(lines.length,boxes.length);
  }
  return lines.join('\n');
}
export function imageCanvas(bitmap){
  const scale=Math.min(1,2600/Math.max(bitmap.width,bitmap.height));
  const result=canvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
  const ctx=result.getContext('2d');
  ctx.fillStyle='white';
  ctx.fillRect(0,0,result.width,result.height);
  ctx.drawImage(bitmap,0,0,result.width,result.height);
  return result;
}
export async function transcribeFile(file,progress,singleLine){
  if(file.size>30*1024*1024)throw Error('Choose a file of 30 MB or less.');
  if(file.name.toLowerCase().endsWith('.pdf')||file.type==='application/pdf'){
    const pdfjs=await import(cdn+'pdfjs-dist@4.10.38/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc=cdn+'pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    const doc=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
    try{
      if(doc.numPages>10)throw Error('Choose a PDF with up to 10 pages.');
      const output=[];
      for(let i=1;i<=doc.numPages;i++){
        const page=await doc.getPage(i);
        const base=page.getViewport({scale:1});
        const view=page.getViewport({scale:Math.min(3,2400/Math.max(base.width,base.height))});
        const target=canvas(Math.ceil(view.width),Math.ceil(view.height));
        progress('Reading page '+i+' of '+doc.numPages+'…');
        await page.render({canvasContext:target.getContext('2d'),viewport:view}).promise;
        const text=await transcribeCanvas(target,{progress:(_,n)=>progress('Reading page '+i+' of '+doc.numPages+' · '+n+' detected lines')});
        if(text)output.push({label:'Page '+i,text});
      }
      return output;
    }finally{await doc.destroy();}
  }
  const bitmap=await createImageBitmap(file);
  try{
    const text=await transcribeCanvas(imageCanvas(bitmap),{singleLine,progress:(_,n)=>progress('Reading image · '+n+' detected lines')});
    return text?[{label:'Transcription',text}]:[];
  }finally{bitmap.close();}
}
