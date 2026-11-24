import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp(join(tmpdir(), 'copilot-edge-'));
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = spawn(edge, ['--headless', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=9622', '--window-size=1000,740', '--user-data-dir=' + profile, 'about:blank'],
  {stdio: 'ignore', windowsHide: true});
const server=spawn('python',['-m','http.server','8984','--bind','127.0.0.1'],{stdio:'ignore',windowsHide:true});
let socket;
try {
  let page;
  for (let i = 0; i < 30 && !page; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9622/json/list')).json()).find(item => item.type === 'page'); }
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
  const url=process.argv[2]||'http://127.0.0.1:8984/';
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url});
  const until=async (expression,steps=60)=>{
    for(let i=0;i<steps;i++){
      const value=await js(expression);
      if(value)return value;
      await delay(500);
    }
    throw Error('Timed out: '+expression+' / '+await js('document.body.innerText.slice(-600)'));
  };
  const shot=async name=>{
    const {data}=await command('Page.captureScreenshot',{format:'png'});
    await writeFile(name+'.png',Buffer.from(data,'base64'));
  };
  const recording=process.env.ARCHIVE_RECORD;
  let frame=0;
  if(recording)await mkdir(recording,{recursive:true});
  const hold=async seconds=>{
    if(!recording)return;
    const end=frame+seconds*5;
    while(frame<end){
      const {data}=await command('Page.captureScreenshot',{format:'png'});
      await writeFile(join(recording,'live-'+String(++frame).padStart(4,'0')+'.png'),Buffer.from(data,'base64'));
      await delay(100);
    }
  };
  const key=async key=>{
    const code=key==='Tab'?9:13;
    await command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,text:key==='Enter'?'\r':'',windowsVirtualKeyCode:code});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});
  };
  await until('document.querySelector("#submit") && !document.querySelector("#submit").disabled',150);
  await command('Page.bringToFront',{});
  await js('document.querySelector(".hero details").open=true; document.querySelector("#date").value="1900-01-06";document.querySelector("#fuzzy").checked=false; document.querySelector("#query").focus()');
  await command('Input.insertText',{text:'Williamsburg'});
  await shot('frame-1');
  await hold(4);
  await key('Enter');
  await until('document.activeElement.id==="results-title" && document.querySelector("#status").textContent.startsWith("Search completed")');
  const exact=await js('[...document.querySelectorAll("#results p")].some(p=>/clymcr/i.test(p.textContent))');
  if(exact)throw Error('Expected baseline to miss the Clymer Street passage');
  await shot('frame-2');
  await hold(4);
  await js('document.querySelector("#fuzzy").click()');
  await until('[...document.querySelectorAll("#results p")].some(p=>/clymcr/i.test(p.textContent))');
  await shot('frame-3');
  await hold(4);
  await key('Tab');await key('Enter');
  await until('document.activeElement.id==="passage-title" && /clymer/i.test(document.querySelector("#transcript").textContent)');
  await until('document.querySelector("#transcript-label").textContent==="Manually checked excerpt" && /wllliamsburg/i.test(document.querySelector("#raw-transcript").textContent)');
  await until('!document.querySelector("#crop").hidden && document.querySelector("#crop").naturalWidth>0');
  await js('document.querySelector("#detail").scrollIntoView({block:"start"})');
  await shot('frame-4');
  await hold(3);
  await js('window.scrollBy(0,180)');
  await hold(3);
  await command('Browser.grantPermissions',{permissions:['clipboardReadWrite','clipboardSanitizedWrite'],origin:new URL(url).origin});
  await key('Tab');await key('Tab');await key('Enter');
  await until('document.querySelector("#copy-status").textContent.startsWith("Copied")');
  await shot('frame-5');
  await hold(4);
  const deepLink=await js('document.querySelector("#permalink").href');
  await command('Page.navigate',{url:deepLink});
  await until('/clymer/i.test(document.querySelector("#transcript")?.textContent||"")',150);
  console.log('Exact miss, OCR recovery, image crop, keyboard focus, copy and permalink verified.');
} finally {
  socket?.close();
  browser.kill();server.kill();
}
