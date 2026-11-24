import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp(join(tmpdir(), 'copilot-edge-'));
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = spawn(edge, ['--headless', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=9632', '--window-size=1000,740', '--user-data-dir=' + profile, 'about:blank'],
  {stdio: 'ignore', windowsHide: true});
const server=spawn('python',['-m','http.server','8992','--bind','127.0.0.1','--directory','..'],{stdio:'ignore',windowsHide:true});
let socket;
try {
  let page;
  for (let i = 0; i < 30 && !page; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9632/json/list')).json()).find(item => item.type === 'page'); }
    catch { await delay(200); }
  }
  if (!page) throw Error('Could not connect to Edge.');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once:true});
    socket.addEventListener('error', reject, {once:true});
  });
  let sequence = 0;
  const command = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const listener = event => {
      const data = JSON.parse(event.data);
      if (data.id !== id) return;
      socket.removeEventListener('message', listener);
      if (data.error) reject(Error(data.error.message)); else resolve(data.result);
    };
    socket.addEventListener('message', listener);
    socket.send(JSON.stringify({id, method, params}));
  });
  const js = expression => command('Runtime.evaluate', {expression, returnByValue:true}).then(x => x.result.value);
  const url=process.argv[2]||'http://127.0.0.1:8992/accessible-archive-search/';
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url});
  const until=async (expression,seconds=75)=>{
    for(let i=0;i<seconds*5;i++){
      if(await js(expression))return;
      const failure=await js('document.querySelector("#upload-status")?.textContent');
      if(failure?.startsWith('Could not'))throw Error(failure);
      await delay(200);
    }
    throw Error('Timed out: '+expression+'; '+await js('document.querySelector("#upload-status")?.textContent'));
  };
  const shot=async name=>{
    if(!process.env.OCR_RECORD)return;
    await delay(220);
    const {data}=await command('Page.captureScreenshot',{format:'png'});
    await writeFile(name+'.png',Buffer.from(data,'base64'));
  };
  await until('typeof document.querySelector("#try-scan")?.onclick==="function"');
  await shot('reader-01');
  await js('document.querySelector("#try-scan").click()');
  await until('document.querySelector("#upload-status").textContent==="Transcription ready."');
  if(!await js('/Clymer/.test(document.querySelector("#upload-text").textContent)'))throw Error('Model result missing Clymer');
  await shot('reader-02');
  const doc=await command('DOM.getDocument',{});
  const {nodeId}=await command('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#document-file'});
  const pdf=join(process.cwd(),'..','accessible-document-reader','examples','water-cycle.pdf');
  await command('DOM.setFileInputFiles',{nodeId,files:[pdf]});
  await js('document.querySelector("#upload-form").requestSubmit()');
  await until('document.querySelector("#upload-status").textContent==="Transcription ready."');
  const text=await js('document.querySelector("#upload-text").textContent');
  if(text.length<100||!/water/i.test(text))throw Error('PDF output missing: '+text);
  console.log('ONNX example and uploaded PDF passed. PDF text length:',text.length);
  await shot('reader-03');
  await until('!document.querySelector("#example").disabled');
  await js('document.querySelector("#example").click()');
  await until('document.querySelector("#results button")');
  await js('document.querySelector("#results button").click()');
  await until('document.querySelector("#transcript").textContent.includes("Clymer")');
  if(await js('Boolean(document.querySelector("#raw-ocr"))'))throw Error('Legacy OCR disclosure remains');
  await js('document.querySelector("#query").value="Broadway";document.querySelector("#form").requestSubmit()');
  await until('document.querySelector("#status").textContent.startsWith("Search completed") && document.querySelector("#results button")');
  await js('document.querySelector("#results button").click()');
  await until('!document.querySelector("#copy").disabled');
  console.log('Archive example and an additional passage transcribed from a live crop.');
} finally {
  socket?.close();
  browser.kill();server.kill();
}
