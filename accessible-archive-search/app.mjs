import {sourceURL} from './engine.mjs';
const el=id=>document.getElementById(id);
const worker=new Worker('./worker.mjs',{type:'module'});
const root='https://tile.loc.gov/storage-services/service/ndnp/nn/batch_nn_aristotle_ver01/data/';
const iiif='https://tile.loc.gov/image-services/iiif/service:ndnp:nn:batch_nn_aristotle_ver01:data:';
const manifests=new Map();
let revision=0, searchID=0, current, fromResult, ready=false;
const hashKey=()=>new URLSearchParams(location.hash.slice(1)).get('passage');
el('transcript').tabIndex=0;
function request(focus=true) {
  const query=el('query').value.trim();
  if(!query||!ready)return;
  el('status').textContent='Searching…';
  const id=++searchID;
  if(!focus)el('form').dataset.noFocus=String(id);
  worker.postMessage({type:'search',id,query,date:el('date').value,fuzzy:el('fuzzy').checked});
}
el('form').onsubmit=event=>{event.preventDefault();request();};
el('fuzzy').onchange=()=>{if(searchID)request();};
el('example').onclick=()=>{
  el('query').value='Williamsburg';
  el('date').value='1900-01-06';
  el('date').closest('details').open=true;
  el('fuzzy').checked=true;
  request();
};
function cite(p) {
  const [,date,edition,sequence]=p.page.split('/');
  return p.title+' · '+date+' · edition '+edition.slice(3)+' · page '+sequence.slice(4);
}
function show(p,origin) {
  current=p;
  fromResult=origin;
  el('back').hidden=!origin;
  el('detail-hint').hidden=true;
  el('passage').hidden=false;
  el('transcript').textContent=p.text;
  el('citation').textContent=cite(p);
  el('source').href=sourceURL(p.page);
  el('permalink').href='#'+new URLSearchParams({passage:p.id});
  el('copy-status').textContent='';
  el('passage-title').focus();
  void showCrop(p);
}
async function xml(url) {
  if(manifests.has(url))return manifests.get(url);
  const response=await fetch(url);
  if(!response.ok)throw Error('Manifest unavailable');
  const doc=new DOMParser().parseFromString(await response.text(),'application/xml');
  if(doc.querySelector('parsererror'))throw Error('Invalid manifest');
  manifests.set(url,doc);
  return doc;
}
async function showCrop(p) {
  const id=++revision, img=el('crop'), status=el('image-status');
  img.hidden=true;
  status.textContent='Loading original scan…';
  const [lccn,date,edition,sequence]=p.page.split('/');
  try{
    const batch=await xml(root+'batch_1.xml');
    const issue=[...batch.getElementsByTagNameNS('*','issue')].find(item=>
      item.getAttribute('lccn')===lccn && item.getAttribute('issueDate')===date && item.getAttribute('editionOrder')===edition.slice(3));
    if(!issue)throw Error('Issue unavailable');
    const path=issue.textContent.trim();
    const mets=await xml(root+path);
    const pages=[...mets.getElementsByTagNameNS('*','fptr')].filter(item=>/^serviceFile\d+$/.test(item.getAttribute('FILEID')));
    const pointer=pages[Number(sequence.slice(4))-1]?.getAttribute('FILEID');
    const file=[...mets.getElementsByTagNameNS('*','file')].find(item=>item.getAttribute('ID')===pointer);
    const jpeg=file?.getElementsByTagNameNS('*','FLocat')[0]?.getAttributeNS('http://www.w3.org/1999/xlink','href');
    if(!jpeg?.endsWith('.jp2'))throw Error('Page image unavailable');
    const [x,y,w,h]=p.box;
    const left=Math.max(0,x-.008),top=Math.max(0,y-.008);
    const region=[left,top,Math.min(1-left,x+w-left+.008),Math.min(1-top,y+h-top+.008)].map(n=>(n*100).toFixed(3)).join(',');
    const uri=iiif+path.slice(0,path.lastIndexOf('/')+1).replaceAll('/',':')+jpeg.slice(0,-4)+'/pct:'+region+'/700,/0/default.jpg';
    if(id!==revision)return;
    img.onload=()=>{if(id===revision){img.hidden=false;status.textContent='Original scan cropped to the OCR block.';}};
    img.onerror=()=>{if(id===revision)status.textContent='Scan unavailable here. Use the full-page source link.';};
    img.src=uri;
  }catch{
    if(id===revision)status.textContent='Scan unavailable here. Use the full-page source link.';
  }
}
el('back').onclick=()=>fromResult?.focus();
el('copy').onclick=async()=>{
  try{
    await navigator.clipboard.writeText(current.text+'\n\n'+cite(current)+'\n'+sourceURL(current.page));
    el('copy-status').textContent='Copied transcript and citation.';
  }catch{el('copy-status').textContent='Clipboard unavailable. Select the transcript to copy it.';}
};
worker.onmessage=({data})=>{
  if(data.type==='ready'){
    ready=true;
    el('submit').disabled=false;
    el('example').disabled=false;
    el('status').textContent=data.pages.toLocaleString()+' pages · '+data.passages.toLocaleString()+' searchable passages';
    if(hashKey())worker.postMessage({type:'passage',key:hashKey()});
  }else if(data.type==='passage'){
    if(data.match)show(data.match);
    else el('status').textContent='This passage link could not be found.';
  }else if(data.type==='error'){
    el('status').textContent=data.message;
  }else if(data.type==='results'&&data.id===searchID){
    el('results').replaceChildren();
    el('hint').hidden=data.matches.length>0;
    el('hint').textContent='Try a different name or enable OCR spelling tolerance.';
    el('results-title').textContent=data.matches.length?data.matches.length+' top results':'No matching passages';
    for(const p of data.matches){
      const row=document.createElement('li'), button=document.createElement('button'), excerpt=document.createElement('p');
      button.textContent='Read passage · '+cite(p);
      button.onclick=()=>show(p,button);
      excerpt.textContent=p.excerpt;
      row.append(button,excerpt);
      el('results').append(row);
    }
    el('status').textContent='Search completed in '+Math.round(data.ms)+' ms.';
    if(el('form').dataset.noFocus!==String(data.id))el('results-title').focus();
  }
};
worker.onerror=()=>{el('status').textContent='The search index could not be loaded.';};
window.addEventListener('hashchange',()=>{if(ready&&hashKey())worker.postMessage({type:'passage',key:hashKey()});});
worker.postMessage({type:'load'});
