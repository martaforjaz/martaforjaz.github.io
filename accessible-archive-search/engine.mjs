export function tokens(text) {
  return text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').match(/[a-z0-9]{2,}/g)||[];
}
export function sourceURL(page) {
  const [title,date,edition,seq]=page.split('/');
  return 'https://www.loc.gov/resource/'+[title,date,edition].join('/')+'/?sp='+seq.slice(4);
}
export function makeIndex(pages) {
  const documents=[], postings=new Map();
  let total=0;
  for(const [page,title,blocks] of pages)for(const [block,text,box] of blocks){
    const words=tokens(text), doc=documents.length;
    documents.push({id:page+'/'+block,page,title,text,box,len:words.length});
    total+=words.length;
    const counts=new Map();
    for(const word of words)counts.set(word,(counts.get(word)||0)+1);
    for(const [word,count] of counts){
      if(!postings.has(word))postings.set(word,[]);
      postings.get(word).push(doc,count);
    }
  }
  const average=total/documents.length || 1;
  const grams=new Map(), cached=new Map();
  const makeGrams=word=>Array.from(new Set(Array.from({length:word.length-2},(_,i)=>word.slice(i,i+3))));
  for(const term of postings.keys())if(term.length>=5){
    for(const gram of makeGrams(term)){
      if(!grams.has(gram))grams.set(gram,[]);
      grams.get(gram).push(term);
    }
  }
  function near(term) {
    if(term.length<5)return [];
    if(cached.has(term))return cached.get(term);
    const candidates=new Map();
    for(const gram of makeGrams(term))for(const word of grams.get(gram)||[]){
      if(word!==term&&Math.abs(word.length-term.length)<=2)candidates.set(word,(candidates.get(word)||0)+1);
    }
    const ordered=[...candidates].filter(([word,common])=>common>=Math.max(1,Math.min(word.length,term.length)-5)&&close(term,word))
      .sort(([a,x],[b,y])=>y-x || postings.get(b).length-postings.get(a).length).slice(0,8).map(([word])=>word);
    if(cached.size>256)cached.clear();
    cached.set(term,ordered);
    return ordered;
  }
  function search(query,fuzzy=true,limit=12,date='') {
    const scores=new Map(), terms=[...new Set(tokens(query))].slice(0,12);
    const expansions=new Set();
    for(const term of terms){
      const best=new Map();
      for(const word of fuzzy?[term,...near(term)]:[term]){
        expansions.add(word);
        const hits=postings.get(word);
        if(!hits)continue;
        const df=hits.length/2;
        const idf=Math.log(1+(documents.length-df+.5)/(df+.5));
        for(let i=0;i<hits.length;i+=2){
          const doc=hits[i],tf=hits[i+1], len=documents[doc].len;
          const score=(word===term?1:.36)*idf*(tf*2.2)/(tf+1.2*(.25+.75*len/average));
          if(score>(best.get(doc)||0))best.set(doc,score);
        }
      }
      for(const [doc,score] of best)if(!date||documents[doc].page.split('/')[1]===date)scores.set(doc,(scores.get(doc)||0)+score);
    }
    return [...scores].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,limit)
      .map(([doc,score])=>{
        const passage=documents[doc];
        const match=[...passage.text.matchAll(/[a-z0-9]{2,}/gi)].find(word=>expansions.has(word[0].toLowerCase()));
        const at=Math.max(0,(match?.index||0)-52);
        const end=at+205;
        const excerpt=(at?'\u2026':'')+passage.text.slice(at,end)+(end<passage.text.length?'\u2026':'');
        return {...passage,score,excerpt};
      });
  }
  return {search,documents};
}
function close(a,b) {
  const fold=s=>s.replace(/rn/g,'m').replace(/[1il]/g,'l').replace(/0/g,'o');
  if(fold(a)===fold(b))return true;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const row=[i];
    for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]!==b[j-1]));
    prev=row;
  }
  return prev.at(-1)<=1;
}
