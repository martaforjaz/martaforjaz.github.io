import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp(join(tmpdir(), 'copilot-edge-'));
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = spawn(edge, ['--headless', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=9626', '--window-size=1000,740', '--user-data-dir=' + profile, 'about:blank'],
  {stdio: 'ignore', windowsHide: true});
const server=spawn('python',['-m','http.server','8986','--bind','127.0.0.1','--directory','..'],{stdio:'ignore',windowsHide:true});
let socket;
try {
  let page;
  for (let i = 0; i < 30 && !page; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9626/json/list')).json()).find(item => item.type === 'page'); }
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
  const url=process.argv[2]||'http://127.0.0.1:8986/ocr/';
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url});
  const until=async expression=>{
    for(let i=0;i<55;i++){
      if(await js(expression))return;
      await delay(200);
    }
    throw Error(await js('document.body.innerText.slice(-800)'));
  };
  const shot=async name=>{
    if(!process.env.OCR_RECORD)return;
    await delay(300);
    const {data}=await command('Page.captureScreenshot',{format:'png'});
    await writeFile(name+'.png',Buffer.from(data,'base64'));
  };
  await until('document.querySelector("#scores")?.children.length===3 && document.querySelector("#scan")?.naturalWidth>0');
  if(!await js('document.querySelector("#comparison").textContent.includes("Clymer")'))throw Error('Williamsburg comparison missing');
  await shot('ocr-01');
  await js('document.querySelector("#compare").scrollIntoView()');
  await shot('ocr-02');
  await js('const field=document.querySelector("#issue");field.focus();field.value="1900-01-03";field.dispatchEvent(new Event("change"));');
  await until('document.querySelector("#scan").naturalWidth>0 && document.querySelector("#comparison").textContent.includes("SHELLED A RUNAWAY TRAIN")');
  if(await js('document.querySelector("#line").options.length')!==11)throw Error('Wrong number of lines in the edition');
  await shot('ocr-03');
  await js('const row=document.querySelector("#line");row.focus();row.value="5";row.dispatchEvent(new Event("change"));');
  await until('document.querySelector("#scan").naturalWidth>0 && document.querySelector("#comparison").textContent.includes("RENSBURG")');
  await shot('ocr-04');
  console.log('Verified three score cards, edition and line switching, matching references, and loaded images.');
} finally {
  socket?.close();
  browser.kill();server.kill();
}
