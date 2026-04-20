const express = require('express');
const { spawn, execSync } = require('child_process');

const app = express();
app.use(express.json());

let serverProcess = null;
let manualStop = false;
let logs = [];
const MAX_LOGS = 500;
const clients = [];
const clientsFull = [];

const DETAIL_PREFIXES = ['[MATÉRIA]', '[MATÉRIAS]', '[UPLOAD]', '[COOKIE]'];

function isDetail(text) {
  return DETAIL_PREFIXES.some(p => text.startsWith(p));
}

function addLog(text, type = 'info') {
  const detail = isDetail(text);
  const entry = { text, type, time: new Date().toLocaleTimeString('pt-BR'), detail };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  clientsFull.forEach(res => res.write(`data: ${JSON.stringify(entry)}\n\n`));
  if (!detail) clients.forEach(res => res.write(`data: ${JSON.stringify(entry)}\n\n`));
}

function getStatus() {
  return serverProcess && !serverProcess.killed ? 'online' : 'offline';
}

function freePort3000() {
  try {
    execSync('for /f "tokens=5" %a in (\'netstat -aon ^| findstr " :3000 "\') do taskkill /F /PID %a', { shell: 'cmd.exe', stdio: 'ignore' });
  } catch {}
}

function killTree(pid) {
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
}

function startServer() {
  if (getStatus() === 'online') return;
  addLog('Liberando porta 3000...', 'info');
  freePort3000();
  setTimeout(() => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    addLog('Iniciando servidor...', 'info');
    serverProcess.stdout.on('data', d => {
      const msg = d.toString().trim();
      if (msg) addLog(msg, 'success');
    });
    serverProcess.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (!msg) return;
      if (msg.includes('EADDRINUSE')) {
        addLog('Erro: porta 3000 ainda em uso. Tente reiniciar o gerenciador.', 'error');
      } else {
        addLog(msg, 'error');
      }
    });
    serverProcess.on('error', err => {
      addLog('Falha ao iniciar: ' + err.message, 'error');
      serverProcess = null;
    });
    serverProcess.on('close', code => {
      if (!manualStop && code !== 0 && code !== null) addLog(`Servidor encerrado inesperadamente (código ${code}).`, 'error');
      manualStop = false;
      serverProcess = null;
    });
  }, 600);
}

function stopServer() {
  if (serverProcess) {
    manualStop = true;
    const pid = serverProcess.pid;
    serverProcess = null;
    killTree(pid);
    addLog('Servidor parado.', 'warn');
  }
}

// SSE — logs resumidos (sem detalhes)
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  logs.filter(e => !e.detail).forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  clients.push(res);
  req.on('close', () => clients.splice(clients.indexOf(res), 1));
});

// SSE — logs completos
app.get('/events-full', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  logs.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  clientsFull.push(res);
  req.on('close', () => clientsFull.splice(clientsFull.indexOf(res), 1));
});

// Página de logs completos
app.get('/logs', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Logs completos</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d10; color: #c8c8d4; font-family: 'Consolas', monospace; font-size: .8rem; padding: 20px; }
  h2 { color: #fff; font-family: 'Segoe UI', sans-serif; font-size: 1rem; margin-bottom: 14px; }
  .log-entry { line-height: 1.7; border-bottom: 1px solid #111; padding: 2px 0; }
  .t { color: #555; margin-right: 8px; }
  .info    .msg { color: #c8c8d4; }
  .success .msg { color: #22c55e; }
  .error   .msg { color: #f87171; }
  .warn    .msg { color: #fbbf24; }
  .detail  .msg { color: #818cf8; }
  #box { height: calc(100vh - 60px); overflow-y: auto; }
  #box::-webkit-scrollbar { width: 4px; }
  #box::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
</style>
</head>
<body>
<h2>Logs completos — <a href="/" style="color:#3b82f6;text-decoration:none">← voltar</a></h2>
<div id="box"></div>
<script>
  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function appendLog(e) {
    const box = document.getElementById('box');
    const div = document.createElement('div');
    div.className = 'log-entry ' + e.type + (e.detail ? ' detail' : '');
    div.innerHTML = '<span class="t">' + e.time + '</span><span class="msg">' + escHtml(e.text) + '</span>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  const es = new EventSource('/events-full');
  es.onmessage = e => appendLog(JSON.parse(e.data));
</script>
</body>
</html>`));

app.get('/status', (req, res) => res.json({ status: getStatus() }));

app.post('/start',   (req, res) => { startServer(); res.json({ ok: true }); });
app.post('/stop',    (req, res) => { stopServer();  res.json({ ok: true }); });
app.post('/restart', (req, res) => { stopServer(); setTimeout(startServer, 800); res.json({ ok: true }); });

app.get('/', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel da Duda</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f13; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 40px 20px; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 8px; color: #fff; letter-spacing: 0.5px; }
  .subtitle { color: #666; font-size: .85rem; margin-bottom: 36px; }

  .card { background: #1a1a22; border: 1px solid #2a2a36; border-radius: 16px; padding: 28px 32px; width: 100%; max-width: 520px; }

  .status-row { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #444; transition: background .4s; flex-shrink: 0; }
  .dot.online  { background: #22c55e; box-shadow: 0 0 8px #22c55e88; }
  .dot.offline { background: #ef4444; box-shadow: 0 0 8px #ef444488; }
  .status-label { font-size: 1rem; font-weight: 500; }
  .status-label span { color: #aaa; font-weight: 400; font-size: .85rem; margin-left: 6px; }

  .btns { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  button { flex: 1; min-width: 120px; padding: 12px 16px; border: none; border-radius: 10px; font-size: .9rem; font-weight: 600; cursor: pointer; transition: opacity .2s, transform .1s; }
  button:active { transform: scale(.97); }
  button:disabled { opacity: .35; cursor: not-allowed; }
  .btn-start   { background: #22c55e; color: #000; }
  .btn-stop    { background: #ef4444; color: #fff; }
  .btn-restart { background: #f59e0b; color: #000; }
  .btn-open    { background: #3b82f6; color: #fff; width: 100%; margin-bottom: 8px; min-width: unset; }
  .btn-logs    { background: none; border: 1px solid #2a2a36; color: #666; width: 100%; margin-bottom: 20px; min-width: unset; font-size: .8rem; padding: 8px; }
  .btn-logs:hover { color: #aaa; border-color: #444; }

  .log-box { background: #0d0d10; border: 1px solid #222; border-radius: 10px; padding: 14px; height: 280px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: .78rem; line-height: 1.6; }
  .log-box::-webkit-scrollbar { width: 4px; }
  .log-box::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
  .log-entry { padding: 1px 0; }
  .log-entry .t { color: #555; margin-right: 6px; }
  .log-entry.info    .msg { color: #c8c8d4; }
  .log-entry.success .msg { color: #22c55e; }
  .log-entry.error   .msg { color: #f87171; }
  .log-entry.warn    .msg { color: #fbbf24; }

  .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .log-title { font-size: .8rem; color: #555; text-transform: uppercase; letter-spacing: 1px; }
  .clear-btn { background: none; border: none; color: #444; font-size: .75rem; cursor: pointer; padding: 2px 6px; border-radius: 4px; min-width: auto; flex: none; }
  .clear-btn:hover { color: #888; background: #1a1a22; }
</style>
</head>
<body>
<h1>Painel da Duda</h1>
<p class="subtitle">Gerenciador do servidor local</p>

<div class="card">
  <div class="status-row">
    <div class="dot" id="dot"></div>
    <div class="status-label" id="statusLabel">Verificando… <span id="statusSub"></span></div>
  </div>

  <div class="btns">
    <button class="btn-start"   id="btnStart"   onclick="action('start')">Iniciar</button>
    <button class="btn-stop"    id="btnStop"    onclick="action('stop')">Parar</button>
    <button class="btn-restart" id="btnRestart" onclick="action('restart')">Reiniciar</button>
  </div>
  <button class="btn-open" id="btnOpen" onclick="window.open('http://localhost:3000/app','_blank')" disabled>Abrir App</button>
  <button class="btn-logs" onclick="window.open('/logs','_blank')">Ver logs completos</button>

  <div class="log-header">
    <span class="log-title">Logs</span>
    <button class="clear-btn" onclick="clearLogs()">limpar</button>
  </div>
  <div class="log-box" id="logBox"></div>
</div>

<script>
  function setStatus(s) {
    const dot = document.getElementById('dot');
    const label = document.getElementById('statusLabel');
    const sub = document.getElementById('statusSub');
    dot.className = 'dot ' + s;
    if (s === 'online') {
      label.childNodes[0].textContent = 'Online ';
      sub.textContent = '— localhost:3000';
    } else {
      label.childNodes[0].textContent = 'Offline ';
      sub.textContent = '';
    }
    document.getElementById('btnStart').disabled   = s === 'online';
    document.getElementById('btnStop').disabled    = s === 'offline';
    document.getElementById('btnRestart').disabled = s === 'offline';
    document.getElementById('btnOpen').disabled    = s === 'offline';
  }

  async function action(cmd) {
    await fetch('/' + cmd, { method: 'POST' });
    setTimeout(pollStatus, 1000);
  }

  async function pollStatus() {
    try {
      const r = await fetch('/status');
      const d = await r.json();
      setStatus(d.status);
    } catch {}
  }

  function appendLog(e) {
    const box = document.getElementById('logBox');
    const div = document.createElement('div');
    div.className = 'log-entry ' + e.type;
    div.innerHTML = '<span class="t">' + e.time + '</span><span class="msg">' + escHtml(e.text) + '</span>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function clearLogs() {
    document.getElementById('logBox').innerHTML = '';
  }

  const es = new EventSource('/events');
  es.onmessage = e => appendLog(JSON.parse(e.data));

  pollStatus();
  setInterval(pollStatus, 3000);
  setStatus('offline');
</script>
</body>
</html>`));

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Gerenciador rodando em http://localhost:${PORT}`);
});
