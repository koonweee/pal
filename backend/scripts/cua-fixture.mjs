import { createServer } from 'node:http';
const state = { clicks: 0, trusted: [], value: '' };
const html = `<!doctype html><title>Pal Cua capability fixture</title>
<h1>Pal Cua capability fixture</h1><label>Reference <input id="reference"></label>
<button id="save">Save reference</button><p id="status">Not saved</p>
<script>document.querySelector('#save').onclick=async e=>{
const r=await fetch('/save',{method:'POST',body:JSON.stringify({value:document.querySelector('#reference').value,trusted:e.isTrusted})});
document.querySelector('#status').textContent='Saved '+(await r.json()).clicks;
};</script>`;
createServer(async (req, res) => {
  if (req.url === '/state') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(state));
  }
  if (req.url === '/save' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const value = JSON.parse(body);
    state.clicks++;
    state.trusted.push(value.trusted);
    state.value = value.value;
    return res.end(JSON.stringify(state));
  }
  res.setHeader('content-type', 'text/html');
  res.end(html);
}).listen(18765, '0.0.0.0');
