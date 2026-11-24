import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp(join(tmpdir(), 'copilot-edge-'));
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = spawn(edge, ['--headless', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=9620', '--window-size=1000,740', '--user-data-dir=' + profile, 'about:blank'],
  {stdio: 'ignore', windowsHide: true});
const server=spawn('python',['-m','http.server','8982','--bind','127.0.0.1'],{stdio:'ignore',windowsHide:true});
let socket;
try {
  let page;
  for (let i = 0; i < 30 && !page; i++) {
    try { page = (await (await fetch('http://127.0.0.1:9620/json/list')).json()).find(item => item.type === 'page'); }
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
  const url=process.argv[2]||'http://127.0.0.1:8982/';
  socket.addEventListener('message', event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown')console.log(message.params.exceptionDetails.exception?.description);
    if(message.method==='Log.entryAdded')console.log(message.params.entry.text);
  });
  await command('Runtime.enable',{});
  await command('Log.enable',{});
  await command('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate',{url});
  const waitFor=async expression=>{
    for(let i=0;i<180;i++){
      const value=await js(expression);
      if(value)return value;
      await delay(300);
    }
    throw Error(await js('document.querySelector("#status")?.textContent')||expression);
  };
  await waitFor('Boolean(document.querySelector("#example"))');
  const key=async key=>{
    const windowsVirtualKeyCode=key==='Enter'?13:9;
    await command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,text:key==='Enter'?'\r':'',unmodifiedText:key==='Enter'?'\r':'',windowsVirtualKeyCode,nativeVirtualKeyCode:windowsVirtualKeyCode});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode,nativeVirtualKeyCode:windowsVirtualKeyCode});
  };
  await waitFor('Boolean(document.querySelector("#example").onclick)');
  await js('document.querySelector("#example").focus()');
  await command('Page.bringToFront',{});
  await key('Enter');
  console.log('After Enter:',await js('document.querySelector("#status").textContent'));
  await waitFor('!document.querySelector("#reader").hidden');
  const passages=await js('[...document.querySelectorAll(".passage > :first-child")].map(p=>p.textContent)');
  console.log(passages);
  const headings=await js('[...document.querySelectorAll("#outline a")].map(a=>a.textContent)');
  await js('Array.from(document.querySelectorAll("#outline a")).find(a=>a.textContent==="Condensation").focus()');
  await key('Enter');
  await waitFor('document.activeElement.matches(".passage") && document.activeElement.firstElementChild.textContent==="Condensation"');
  await js('document.querySelector("#query").value="snow";document.querySelector("#query").focus()');
  await key('Enter');
  if(await js('document.activeElement.id')!=='results-title')throw Error('Search focus');
  await key('Tab');await key('Enter');
  await waitFor('document.activeElement.matches(".passage") && document.querySelector("#preview").width>0');
  await key('Tab');await key('Tab');
  if(await js('document.activeElement.textContent')!=='Copy passage')throw Error('Copy focus');
  await command('Browser.grantPermissions',{permissions:['clipboardReadWrite','clipboardSanitizedWrite'],origin:new URL(url).origin});
  await key('Enter');
  await waitFor('document.activeElement.textContent==="Copied"');
  const {data}=await command('Page.captureScreenshot',{format:'png'});
  await writeFile('examples/demo.png',Buffer.from(data,'base64'));
  await js('document.querySelector("#nasa").click()');
  await waitFor('document.querySelector("#status").textContent.startsWith("2 pages ready")');
  const nasaPassages=await js('document.querySelectorAll(".passage").length');
  await writeFile('examples/observed.json',JSON.stringify({passages,headings,nasaPassages,keyboardTasks:['open scan','navigate via headings','search','jump and highlight','copy']},null,2)+'\n');
  console.log('NASA passages:',nasaPassages,'; five keyboard tasks passed.');
} finally {
  socket?.close();
  browser.kill();server.kill();
}
