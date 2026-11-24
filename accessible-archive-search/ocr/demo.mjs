const el=id=>document.getElementById(id);
const percent=value=>(100*value).toFixed(1)+'%';
const make=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
function tile(title,old,current){
  const div=make('div','');
  div.append(make('strong',percent(old)+' → '+percent(current)),make('span',title));
  return div;
}
async function json(path){
  const response=await fetch(path);
  if(!response.ok)throw Error(path);
  return response.json();
}
try {
  const [baseline,expanded,sun,williamsburg]=await Promise.all([
    json('results/metrics.json'),json('results/metrics-v2.json'),json('results/the-sun-evaluation.json'),json('results/williamsburg-v2.json')
  ]);
  el('scores').append(
    tile('Public held-out test · character error',baseline.test.cer,expanded.test.cer),
    tile('Other editions of The Sun · character error',sun.overall.initial.cer,sun.overall.expanded.cer),
    tile('Williamsburg · archived OCR vs. expanded model',williamsburg.archived_ocr.cer,williamsburg.neural_ocr.cer)
  );
  const special='1900-01-06';
  const rows=[...sun.lines,...williamsburg.lines.map((row,i)=>({...row,issue:special,line:i+1}))];
  for(const issue of [...new Set(rows.map(r=>r.issue))].sort())el('issue').add(new Option(issue,issue));
  function show(){
    const row=rows.find(r=>r.issue===el('issue').value&&r.line===Number(el('line').value));
    el('scan').src='samples/'+row.issue+'-'+row.line+'.png';
    el('source').href='https://www.loc.gov/resource/sn83030272/'+row.issue+'/ed-1/?sp='+(row.issue===special?4:1);
    const pairs=[['Checked transcription',row.reference],
      row.issue===special?['Archived OCR',row.archived_ocr]:['First neural model',row.initial],
      ['Expanded neural model',row.neural_ocr??row.expanded]];
    el('comparison').replaceChildren(...pairs.flatMap(([label,value])=>[make('dt',label),make('dd',value)]));
  }
  function selectLines(){
    el('line').replaceChildren(...rows.filter(r=>r.issue===el('issue').value).map(r=>new Option('Line '+r.line,r.line)));
    if(el('issue').value===special)el('line').value='3';
    show();
  }
  el('issue').value=special;
  el('issue').onchange=selectLines;
  el('line').onchange=show;
  el('issue').disabled=el('line').disabled=false;
  selectLines();
  el('status').textContent='Choose an edition and a line to compare.';
} catch {
  el('status').textContent='The line comparisons could not be loaded.';
}
