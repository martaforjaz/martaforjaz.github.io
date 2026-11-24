import {transcribeFile} from './neural.mjs';
const el=id=>document.getElementById(id);
const note=text=>{el('upload-status').textContent=text;};
let transcript='',previewURL;
async function run(getFile,singleLine){
  for(const id of ['try-scan','transcribe','document-file','single-line'])el(id).disabled=true;
  el('upload-result').hidden=true;
  el('upload-copy-status').textContent='';
  note('Loading the trained model…');
  try {
    const file=await getFile();
    const pages=await transcribeFile(file,note,singleLine);
    if(!pages.length){note('The model could not find readable text. Try a clearer scan.');return;}
    transcript=pages.map(page=>pages.length>1?page.label+'\n'+page.text:page.text).join('\n\n');
    if(previewURL)URL.revokeObjectURL(previewURL);
    const picture=el('upload-preview');
    picture.hidden=!file.type.startsWith('image/');
    if(!picture.hidden){previewURL=URL.createObjectURL(file);picture.src=previewURL;}
    el('upload-text').textContent=transcript;
    el('upload-result').hidden=false;
    note('Transcription ready.');
    el('upload-title').focus();
  }catch(error){note('Could not read the document. '+error.message);}
  finally{for(const id of ['try-scan','transcribe','document-file','single-line'])el(id).disabled=false;}
}
el('upload-form').onsubmit=event=>{
  event.preventDefault();
  const file=el('document-file').files[0];
  if(file)void run(()=>file,el('single-line').checked);
};
el('try-scan').onclick=()=>void run(async()=>{
  const response=await fetch('ocr/samples/1900-01-06-3.png');
  if(!response.ok)throw Error('Example unavailable.');
  return new File([await response.blob()],'newspaper-line.png',{type:'image/png'});
},true);
el('upload-copy').onclick=async()=>{
  try{await navigator.clipboard.writeText(transcript);el('upload-copy-status').textContent='Copied.';}
  catch{el('upload-copy-status').textContent='Select the text to copy it.';}
};
el('upload-download').onclick=()=>{
  const url=URL.createObjectURL(new Blob([transcript],{type:'text/plain;charset=utf-8'}));
  const link=Object.assign(document.createElement('a'),{href:url,download:'transcription.txt'});
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
