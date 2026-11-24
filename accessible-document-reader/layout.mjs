const center = b => (b.box.y0 + b.box.y1) / 2;
export function readingOrder(blocks, width) {
  const middle = width / 2;
  const left = b => b.box.x1 < middle + width * .025 && b.box.x0 < middle - width * .12;
  const right = b => b.box.x0 > middle - width * .025;
  const byRow = (a,b) => center(a)-center(b) || a.box.x0-b.box.x0;
  const spans = blocks.filter(b=>!left(b)&&!right(b)).sort(byRow);
  const remaining = blocks.filter(b=>left(b)||right(b)).sort(byRow);
  const ordered = [];
  function band(rows) {
    const l = rows.filter(left), r = rows.filter(right);
    const overlaps = l.some(a=>r.some(b=>a.box.y0<b.box.y1 && b.box.y0<a.box.y1));
    ordered.push(...(overlaps?[...l,...r]:rows));
  }
  for (const span of spans) {
    band(remaining.splice(0, remaining.filter(b=>center(b)<center(span)).length));
    ordered.push(span);
  }
  band(remaining);
  return ordered;
}
export function normalize(text) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
}
export function searchPassages(passages, query) {
  const phrase=normalize(query);
  return phrase ? passages.filter(p=>normalize(p.text).includes(phrase)) : [];
}

function boxFor(items) {
  return {
    x0:Math.min(...items.map(x=>x.bbox.x0)),y0:Math.min(...items.map(x=>x.bbox.y0)),
    x1:Math.max(...items.map(x=>x.bbox.x1)),y1:Math.max(...items.map(x=>x.bbox.y1))
  };
}
function makePassage(lines) {
  const bbox=boxFor(lines);
  return {
    box:bbox,confidence:Math.min(...lines.map(l=>l.confidence)),lineCount:lines.length,
    lineHeight:lines.reduce((sum,l)=>sum+l.bbox.y1-l.bbox.y0,0)/lines.length,
    text:lines.map(l=>l.text.trim()).join('\n').replace(/-\n(?=\p{L})/gu,'').replace(/\s+/g,' ').trim()
  };
}
export function reconstruct(blocks,width) {
  const paragraphs=blocks.flatMap(block=>block.paragraphs||[]).filter(p=>p.lines?.length);
  const middle=width/2;
  function divide(line) {
    const words=line.words||[];
    const left=words.filter(w=>w.bbox.x1<middle);
    const right=words.filter(w=>w.bbox.x0>=middle);
    if(!left.length||!right.length||left.length+right.length!==words.length)return null;
    if(boxFor(right).x0-boxFor(left).x1<width*.035)return null;
    return [left,right].map(group=>({
      bbox:boxFor(group),confidence:Math.min(...group.map(w=>w.confidence)),
      text:group.map(w=>w.text).join(' ')
    }));
  }
  const lines=paragraphs.flatMap(p=>p.lines);
  if(lines.filter(divide).length<3)return paragraphs.map(p=>makePassage(p.lines)).filter(p=>p.text);
  const buckets=[[],[],[]];
  for(const line of lines){
    const split=divide(line);
    if(split){buckets[0].push(split[0]);buckets[1].push(split[1]);continue;}
    const {x0,x1}=line.bbox;
    buckets[x1<middle?0:x0>=middle?1:2].push(line);
  }
  return buckets.flatMap(bucket=>{
    const groups=[];
    for(const line of bucket.sort((a,b)=>a.bbox.y0-b.bbox.y0)){
      const previous=groups.at(-1)?.at(-1);
      const height=line.bbox.y1-line.bbox.y0;
      const prevHeight=previous?previous.bbox.y1-previous.bbox.y0:0;
      if(!previous||line.bbox.y0-previous.bbox.y1>Math.max(height,prevHeight)*.85||
        Math.max(height,prevHeight)>Math.min(height,prevHeight)*1.23)groups.push([]);
      groups.at(-1).push(line);
    }
    return groups.map(makePassage);
  }).filter(p=>p.text);
}
