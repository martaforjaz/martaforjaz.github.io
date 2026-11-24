import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {setTimeout as wait} from 'node:timers/promises';
import {makeIndex} from './engine.mjs';
const dir=mkdtempSync(join(tmpdir(),'archive-'));
const db=join(dir,'audit.sqlite'), snapshot=join(dir,'snapshot.json.gz');
const source=process.argv[2]||'ny.tar.bz2';
const args=(...rest)=>['ingest.py','ingest',source,'--database',db,...rest];
const call=(cmd,expect=0)=>{
  const r=spawnSync('python',cmd,{encoding:'utf8'});
  if(r.status!==expect)throw Error(r.stderr||r.stdout||String(r.status));
  return r.stdout;
};
const publish=()=>{
  call(['ingest.py','export','--database',db,'--output',snapshot]);
  return JSON.parse(gunzipSync(readFileSync(snapshot)));
};
try{
  call(args('--simulate-crash','24'),86);
  const before=publish();
  if(before.length!==24)throw Error('Checkpoint lost after interruption');
  const searchPages=JSON.parse(gunzipSync(readFileSync("corpus.json.gz")));
  const index=makeIndex(searchPages);
  function measure(){
    const start=performance.now();
    index.search('Williamsburg',true,10,'1900-01-06');
    return performance.now()-start;
  }
  for(let i=0;i<10;i++)measure();
  const idle=[], active=[];
  for(let i=0;i<60;i++)idle.push(measure());
  const writer=spawn('python',args('--limit','36'),{stdio:'inherit'});
  const finished=new Promise((resolve,reject)=>{
    writer.once('error',reject);
    writer.once('exit',code=>code===0?resolve():reject(Error('Import failed: '+code)));
  });
  while(writer.exitCode===null&&active.length<300){active.push(measure());await wait(10);}
  await finished;
  const after=publish();
  if(after.length!==60||new Set(after.map(p=>p[0])).size!==60)throw Error('Duplicate or missing page');
  if(!before.every(p=>after.some(row=>JSON.stringify(row)===JSON.stringify(p))))throw Error('Changed committed pages');
  const retry=call(args('--max-source-pages','60'));
  if(!retry.includes('0 newly committed pages. 60 total.'))throw Error('Retry changed database');
  const p95=times=>+times.sort((a,b)=>a-b)[Math.ceil(times.length*.95)-1].toFixed(2);
  const metrics={search_snapshot_pages:searchPages.length,interrupted_after:24,resumed_new_pages:36,duplicates:0,idle_queries:idle.length,during_import_queries:active.length,idle_p95_ms:p95(idle),during_import_p95_ms:p95(active)};
  writeFileSync('recovery.json',JSON.stringify(metrics,null,2)+'\n');
  console.log(metrics);
}finally{for(const file of [db,db+'-shm',db+'-wal',snapshot,join(dir,'snapshot.json.tmp')])rmSync(file,{force:true});rmdirSync(dir);}
