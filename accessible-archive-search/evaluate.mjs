import {makeIndex} from './engine.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const pages=JSON.parse(gunzipSync(readFileSync(process.argv[2]||'corpus.json.gz')));
const index=makeIndex(pages);
const judgments=JSON.parse(readFileSync('judgments.json'));
const p95=times=>times.sort((a,b)=>a-b)[Math.ceil(times.length*.95)-1];
const queries=[...new Map(judgments.map(j=>[j.query+'|'+j.date,j])).values()];
const stats={pages:pages.length,passages:index.documents.length,known_passages:judgments.length,queries:queries.length};
for(const fuzzy of [false,true]){
  const times=[], ranks=[];
  let hits=0,reciprocal=0,retrieved=0;
  for(const item of queries){
    const relevant=judgments.filter(j=>j.query===item.query&&j.date===item.date);
    for(const j of relevant)if(!index.documents.some(p=>p.id===j.passage))throw Error('Missing reference '+j.passage);
    for(let run=0;run<12;run++){
      const start=performance.now();
      const results=index.search(item.query,fuzzy,10,item.date);
      if(run>1)times.push(performance.now()-start);
      if(run!==0)continue;
      const matched=relevant.map(j=>({passage:j.passage,rank:results.findIndex(p=>p.id===j.passage)+1}));
      const valid=matched.map(p=>p.rank).filter(Boolean);
      if(valid.length){hits++;reciprocal+=1/Math.min(...valid);}
      retrieved+=valid.length;
      ranks.push({query:item.query,date:item.date,matched});
    }
  }
  stats[fuzzy?'ocr_tolerant':'bm25']={hit_at_10:hits/queries.length,known_passage_recall_at_10:retrieved/judgments.length,mrr_at_10:reciprocal/queries.length,p95_ms:+p95(times).toFixed(2),ranks};
}
writeFileSync('evaluation.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify({...stats,bm25:{...stats.bm25,ranks:undefined},ocr_tolerant:{...stats.ocr_tolerant,ranks:undefined}}));
