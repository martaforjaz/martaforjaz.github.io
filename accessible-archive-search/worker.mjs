import {makeIndex} from './engine.mjs';
let index;
self.onmessage=async ({data})=>{
  try{
    if(data.type==='load'){
      const response=await fetch('./corpus.json.gz');
      if(!response.ok)throw Error('Archive download failed');
      const pages=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
      index=makeIndex(pages);
      self.postMessage({type:'ready',pages:pages.length,passages:index.documents.length});
    }else if(data.type==='search'){
      const start=performance.now();
      const matches=index.search(data.query,data.fuzzy,12,data.date);
      self.postMessage({type:'results',matches,id:data.id,ms:performance.now()-start});
    }else if(data.type==='passage'){
      self.postMessage({type:'passage',match:index.documents.find(p=>p.id===data.key)});
    }
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
