'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('./config.cjs');

const port = Number(process.env.REPORT_WEB_PORT || 5008);
const host = process.env.REPORT_WEB_HOST || '127.0.0.1';
const outputDir = process.env.REPORT_OUTPUT_DIR || '/reports';
const passwordFile = process.env.ACTUAL_PASSWORD_FILE || '/run/secrets/actual_password';
let generating = false;

const reportGroups = JSON.stringify(config.funds.filter(fund => !fund.isGeneral).map(({ key, name }) => ({ key, name }))).replace(/</g, '\\u003c');
const reportKeys = new Set(['AG', ...config.funds.filter(fund => !fund.isGeneral).map(fund => fund.key)]);
const reportStartYear = Number(config.reportStartYear || new Date().getFullYear());
const html = `<!doctype html>
<html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AG-Mittelverwendungsnachweis</title>
<style>
  :root{font:16px system-ui,sans-serif;color:#17212b;background:#f4f6f8}body{max-width:800px;margin:4rem auto;padding:0 1.25rem}
  main{background:white;border:1px solid #d8dee5;border-radius:12px;padding:2rem;box-shadow:0 6px 24px #17212b12}
  h1{margin-top:0}label{display:block;margin:.75rem 0 .35rem;font-weight:600}select,button{font:inherit;padding:.65rem .8rem;border-radius:7px;border:1px solid #9ba8b5}
  button{background:#174ea6;color:white;border:0;margin-left:.5rem;cursor:pointer}button:disabled{opacity:.55;cursor:wait}
  #status{margin:1.2rem 0;min-height:1.5rem}.links{display:grid;gap:.55rem;margin-top:1rem}.links a{color:#174ea6}
  .muted{color:#536273;font-size:.94rem}code{background:#f1f3f5;padding:.15rem .3rem;border-radius:4px}
</style>
<main><h1>AG-Mittelverwendungsnachweis</h1>
<p>Erzeuge den AG-Gesamtnachweis und die Berichte der vier Gruppierungen. Hochgeladene Rechnungen werden den passenden ZIP-Berichten beigef�gt.</p>
<form id="form"><label for="year">Berichtsjahr</label><select id="year" name="year"></select><button id="submit">Berichte erzeugen</button></form>
<p id="status" role="status" aria-live="polite"></p><section id="links" class="links"></section>
<p class="muted">Die Seite ist nur lokal auf dem Pi erreichbar. F�r den Zugriff von einem anderen Ger�t einen SSH-Tunnel auf Port 5007 verwenden.</p></main>
<script>
const groups=${reportGroups}, year=document.querySelector('#year'), now=new Date().getFullYear();
for(let y=now;y>=Math.min(${reportStartYear},now);y--){const o=document.createElement('option');o.value=y;o.textContent=y;year.append(o)}
const form=document.querySelector('#form'),button=document.querySelector('#submit'),status=document.querySelector('#status'),links=document.querySelector('#links');
form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;links.replaceChildren();status.textContent='Berichte werden erstellt .';
 try{const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({year:year.value})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Berichterstellung fehlgeschlagen');
 status.textContent='Berichte erstellt. Der aktuelle Stand kann noch unvollst�ndige Ausgaben enthalten.';
 const files=[['AG-Gesamtnachweis (ZIP)','AG-Mittelverwendungsnachweis-'+year.value+'.zip'],['AG-Bericht (Markdown)','AG-Mittelverwendungsnachweis-'+year.value+'.md']];
 for(const group of groups)files.push([group.name+' (ZIP)',group.key+'-Mittelverwendungsnachweis-'+year.value+'.zip']);
 for(const [label,file] of files){const a=document.createElement('a');a.href='/reports/'+encodeURIComponent(file);a.textContent=label;a.download=file;links.append(a)}
 }catch(err){status.textContent=err.message}finally{button.disabled=false}});
</script></html>`;

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function authenticated(req) {
  const password = (await fs.readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '');
  const expected = Buffer.from(`ag:${password}`).toString('base64');
  const received = String(req.headers.authorization || '').replace(/^Basic\s+/i, '');
  return received === expected;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) throw new Error('Anfrage zu gro�.');
  }
  return new URLSearchParams(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!await authenticated(req)) return send(res, 401, 'Anmeldung erforderlich.', 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="AG-Nachweise", charset="UTF-8"' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, html, 'text/html; charset=utf-8', { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const form = await readBody(req);
      const year = Number(form.get('year'));
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return send(res, 400, JSON.stringify({ error: 'Ung�ltiges Berichtsjahr.' }), 'application/json');
      if (generating) return send(res, 409, JSON.stringify({ error: 'Ein Bericht wird bereits erstellt.' }), 'application/json');
      generating = true;
      const child = spawn(process.execPath, [path.join(__dirname, 'report.cjs'), String(year)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk.toString(); });
      child.stderr.on('data', chunk => { output += chunk.toString(); });
      child.on('error', error => { generating = false; send(res, 500, JSON.stringify({ error: `Bericht konnte nicht gestartet werden: ${error.message}` }), 'application/json'); });
      child.on('close', code => {
        generating = false;
        if (code !== 0) return send(res, 500, JSON.stringify({ error: `Berichterstellung fehlgeschlagen (Code ${code}).`, detail: output.slice(-2000) }), 'application/json');
        send(res, 200, JSON.stringify({ ok: true, year }), 'application/json');
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/reports/')) {
      const filename = decodeURIComponent(url.pathname.slice('/reports/'.length));
      const match = filename.match(/^(.+)-Mittelverwendungsnachweis-\d{4}\.(zip|md)$/);
      if (!match || !reportKeys.has(match[1])) return send(res, 404, 'Datei nicht gefunden.');
      const fullPath = path.join(outputDir, filename);
      const data = await fs.readFile(fullPath);
      const type = filename.endsWith('.zip') ? 'application/zip' : 'text/markdown; charset=utf-8';
      return send(res, 200, data, type, { 'Content-Disposition': `attachment; filename="${filename}"` });
    }
    return send(res, 404, 'Nicht gefunden.');
  } catch (error) {
    return send(res, 500, `Interner Fehler: ${error.message}`);
  }
});

server.listen(port, host, () => console.log(`AG-Report-WebUI bereit auf http://${host}:${port}`));

