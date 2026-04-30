require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const FormData = require('form-data');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ── LOG DE TODAS AS REQUISIÇÕES ──
app.use((req, res, next) => {
  const ignorar = ['/health', '/status', '/events', '/events-full', '/foto-enviada', '/publicar-status', '/login-completo', '/feedback', '/publicacao-pendente', '/publicadas'];
  if (!ignorar.includes(req.path)) {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local';
    const origem = req.headers['origin'] || req.headers['referer'] || '—';
    console.log(`[REQ] ${req.method} ${req.path} | IP: ${ip} | Origem: ${origem}`);
  }
  next();
});

// ── HEALTH CHECK (público — sem token) ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), ts: Date.now() });
});

// ── AUTENTICAÇÃO POR TOKEN (opcional) ──
// Para ativar: defina TANAKA_TOKEN no ambiente antes de rodar o servidor
//   Windows: set TANAKA_TOKEN=minhasenha && node server.js
//   .env:    TANAKA_TOKEN=minhasenha
// O app salva o token em Configurações → Token de Acesso.
// Rotas públicas (/, /app, /health) ficam abertas para o app carregar e verificar status.
const TANAKA_TOKEN = process.env.TANAKA_TOKEN || '';
if (TANAKA_TOKEN) {
  app.use((req, res, next) => {
    const rotasPublicas = ['/', '/app', '/health'];
    if (rotasPublicas.includes(req.path)) return next();
    // Rotas usadas pelo Tampermonkey (roda no PC, chama localhost diretamente)
    const rotasTampermonkey = ['/google-imagens', '/foto-enviada', '/diagnostico', '/publicar-status', '/login-completo', '/publicacao-pendente', '/payload-publicar'];
    if (rotasTampermonkey.includes(req.path)) return next();
    const token = req.headers['x-tanaka-token'] || req.query.token || '';
    if (token !== TANAKA_TOKEN) return res.status(401).json({ erro: 'Token inválido' });
    next();
  });
  console.log('[AUTH] Proteção por token ativa.');
}
const path2 = require('path');

// ── PAYLOAD DE PUBLICAÇÃO (evita URL longa no comando do Windows) ──
// Frontend salva o JSON aqui e recebe um token curto.
// Tampermonkey busca o payload pelo token — URL fica pequena.
const payloadsPendentes = new Map();

app.post('/payload-publicar', (req, res) => {
  const dados = req.body;
  if (!dados || (!dados.titulo && !dados.texto)) return res.status(400).json({ ok: false, erro: 'Payload inválido' });
  const token = Math.random().toString(36).slice(2, 10); // 8 chars aleatórios
  payloadsPendentes.set(token, dados);
  setTimeout(() => payloadsPendentes.delete(token), 10 * 60 * 1000); // expira em 10min
  console.log(`[PAYLOAD] Salvo token=${token} para: "${String(dados.titulo || '').substring(0, 40)}"`);
  res.json({ ok: true, token });
});

app.get('/payload-publicar', (req, res) => {
  const { token } = req.query;
  const dados = payloadsPendentes.get(token);
  if (!dados) return res.status(404).json({ ok: false, erro: 'Payload não encontrado ou expirado' });
  res.json({ ok: true, ...dados });
});

// ── PUBLICADAS (estado compartilhado entre todos os usuários) ──
const publicadasSet = new Set();

app.get('/publicadas', (req, res) => {
  res.json({ links: [...publicadasSet] });
});

app.post('/publicadas', (req, res) => {
  const links = Array.isArray(req.body?.links) ? req.body.links : [];
  links.forEach(l => { if (typeof l === 'string' && l) publicadasSet.add(l); });
  res.json({ links: [...publicadasSet] });
});

app.get('/', (req, res) => {
  res.sendFile(path2.join(__dirname, 'app-duda.html'));
});
app.get('/app', (req, res) => {
  res.redirect('/');
});

// ── PWA — arquivos estáticos ──
app.get('/manifest.json',      (req, res) => res.sendFile(path2.join(__dirname, 'public', 'manifest.json')));
app.get('/service-worker.js',  (req, res) => { res.setHeader('Service-Worker-Allowed', '/'); res.sendFile(path2.join(__dirname, 'public', 'service-worker.js')); });
app.get('/offline.html',       (req, res) => res.sendFile(path2.join(__dirname, 'public', 'offline.html')));
app.use('/icons', express.static(path2.join(__dirname, 'public', 'icons')));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const GRAPHQL_URL = 'https://gauchazh.clicrbs.com.br/graphql?v=2';

const NEXT_BASE         = 'https://admin-dc4.nextsite.com.br/t53kx1_admin';
const NEXT_JORNAL_LOGIN = process.env.NEXT_JORNAL_LOGIN || 'diariodecuiaba';
const NEXT_JORNAL_SENHA = process.env.NEXT_JORNAL_SENHA || '6cr_qYQP*Gf_sGk';
const NEXT_CMS_USER     = process.env.NEXT_CMS_USER     || 'Maria Eduarda';
const NEXT_CMS_PASS     = process.env.NEXT_CMS_PASS     || '123456';

async function fazerLoginAuto() {
  console.log('[LOGIN-AUTO] Sessão expirada — fazendo login automático...');
  const UA = 'Mozilla/5.0';
  let jar = {};
  const r0 = await axios.get(`${NEXT_BASE}/login.php`, { headers: { 'User-Agent': UA }, maxRedirects: 0, validateStatus: s => s < 500, timeout: 10000 });
  jar = parseCookies(r0.headers['set-cookie']);
  const r1 = await axios.post(`${NEXT_BASE}/login.php`, new URLSearchParams({ login_empresa: NEXT_JORNAL_LOGIN, senha_empresa: NEXT_JORNAL_SENHA }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'Cookie': cookiesToStr(jar) }, maxRedirects: 0, validateStatus: s => s < 500, timeout: 10000 });
  jar = { ...jar, ...parseCookies(r1.headers['set-cookie']) };
  if (r1.status !== 302) throw new Error('Login do jornal falhou');
  const r2 = await axios.get(`${NEXT_BASE}/login_cms.php`, { headers: { 'User-Agent': UA, 'Cookie': cookiesToStr(jar) }, maxRedirects: 0, validateStatus: s => s < 500, timeout: 10000 });
  jar = { ...jar, ...parseCookies(r2.headers['set-cookie']) };
  const r3 = await axios.post(`${NEXT_BASE}/login_cms.php`, new URLSearchParams({ login: NEXT_CMS_USER, senha: NEXT_CMS_PASS }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'Cookie': cookiesToStr(jar) }, maxRedirects: 0, validateStatus: s => s < 500, timeout: 15000 });
  jar = { ...jar, ...parseCookies(r3.headers['set-cookie']) };
  const phpsessid = jar['PHPSESSID'];
  if (!phpsessid) throw new Error('PHPSESSID não obtido após login');
  cookieSalvo = phpsessid;
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ phpsessid }));
  console.log(`[LOGIN-AUTO] ✅ Login feito — PHPSESSID: ${phpsessid.substring(0, 8)}...`);
  return phpsessid;
}

function parseCookies(setCookieArr) {
  const jar = {};
  (setCookieArr || []).forEach(str => {
    const [pair] = str.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  });
  return jar;
}
function cookiesToStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── Sanitiza aspas especiais e caracteres problemáticos ──
function sanitizar(str) {
  if (!str) return '';
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00A0/g, ' ');
}

function formatarData(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('pt-BR');
}

// ── Converte qualquer texto em slug limpo para nome de arquivo ──
function toSlug(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[^a-zA-Z0-9\s-]/g, '')                     // remove especiais
    .replace(/\s+/g, '-')                                 // espaços → hífens
    .replace(/-+/g, '-')                                  // hífens duplos
    .replace(/^-|-$/g, '')                                // hífens nas pontas
    .toLowerCase()
    .substring(0, 60);                                    // limita tamanho
}

// ── Extrai palavras-chave (times, jogadores) — prioriza nomes próprios ──
function extrairPalavrasChave(titulo) {
  const stop = new Set([
    'de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem',
    'que','se','o','a','os','as','um','uma','ao','e','ou','mas','mais','como',
    'foi','é','são','vai','tem','já','após','até','sobre','pelo','pela',
    'novo','nova','boa','bom','grande','quando','onde','quem',
  ]);
  const palavras = titulo.replace(/[^\wÀ-ÿ\s]/g, ' ').split(/\s+/)
    .filter(p => p.length > 2 && !stop.has(p.toLowerCase()));
  const proprias = palavras.filter(p => /^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  const demais = palavras.filter(p => !/^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  return [...new Set([...proprias, ...demais])].slice(0, 5).join(' ');
}

// ── Gera legenda curta para o campo titulo_wda no NextSite ──
function gerarLegenda(titulo) {
  const stop = new Set([
    'de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem',
    'que','se','o','a','os','as','um','uma','ao','e','ou','mas','mais','como',
    'foi','é','são','vai','tem','já','após','até','sobre','pelo','pela',
    'divulga','afirma','anuncia','confirma','declara','revela','diz','fala',
    'vence','venceu','bate','perde','empata','marca','sofre','leva','ganha',
    'joga','jogou','estreia','retorna','volta','sai','entra','assina',
  ]);
  const palavras = titulo.replace(/[^\wÀ-ÿ\s]/g, ' ').split(/\s+/)
    .filter(p => p.length > 2 && !stop.has(p.toLowerCase()));
  const proprias = palavras.filter(p => /^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  return [...new Set(proprias)].slice(0, 4).join(' ') || extrairPalavrasChave(titulo);
}

// ── Remove formatação markdown das legendas geradas por IA ──
function limparLegenda(txt) {
  return (txt || '')
    .replace(/^#+\s*/g, '')            // remove # ## ###
    .replace(/^legenda\s*[:：]\s*/i, '') // remove "Legenda:"
    .replace(/\*+/g, '')               // remove **negrito**
    .replace(/[.!?]$/, '')             // remove pontuação no final
    .trim();
}

// ── Traduz erros técnicos para português ──
function traduzirErro(e) {
  if (e.code === 'ECONNRESET')                                         return 'Conexão interrompida. Tente de novo.';
  if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message)) return 'A IA demorou para responder. Tente de novo.';
  if (e.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /tls|socket disconnected/i.test(e.message)) return 'Erro de conexão segura. Tente de novo.';
  if (e.response?.status === 401)                                      return 'Chave de API inválida ou sem permissão.';
  if (e.response?.status === 404)                                      return 'Matéria não encontrada.';
  if (e.response?.status === 403)                                      return 'Acesso negado pelo site.';
  if (e.response?.status === 429)                                      return 'Limite de uso da IA atingido. Aguarde um momento.';
  if (e.response?.status === 500)                                      return 'Erro interno. Tente de novo em instantes.';
  if (e.response?.status)                                              return `Erro ${e.response.status} do servidor.`;
  return 'Erro inesperado. Tente de novo.';
}

// ── Retry automático para erros de conexão ──
async function comRetry(fn, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      const retentar = e.code === 'ECONNRESET' || e.code === 'ECONNABORTED' || /socket disconnected|tls/i.test(e.message || '');
      if (!retentar || i === tentativas - 1) throw e;
      console.log(`[RETRY] Tentativa ${i + 2}/${tentativas} após ${e.code || 'socket error'}...`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Cookie global persistido em arquivo — sobrevive a reinicializações do servidor
const COOKIE_FILE = path.join(__dirname, 'cookie.json');
let cookieSalvo = null;
try {
  const dados = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  cookieSalvo = dados.phpsessid || null;
  if (cookieSalvo) console.log('[COOKIE] Carregado do arquivo');
} catch {}

// ── LOGIN-COMPLETO (relay Tampermonkey → app) ──
let loginCompletoTs = 0;
app.post('/login-completo', (req, res) => {
  loginCompletoTs = Date.now();
  console.log('[LOGIN] ✅ Tampermonkey confirmou login completo');
  res.json({ ok: true });
});
app.get('/login-completo', (req, res) => {
  const ts = loginCompletoTs;
  const ok = ts > 0;
  if (ok) loginCompletoTs = 0;
  res.json({ ok, ts });
});

// ── STATUS ──
app.get('/status', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

// ── COOKIE ──
app.post('/cookie', (req, res) => {
  const { phpsessid } = req.body;
  if (!phpsessid) return res.status(400).json({ ok: false, erro: 'Cookie não informado' });
  if (cookieSalvo !== phpsessid) {
    cookieSalvo = phpsessid;
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({ phpsessid }));
    console.log('[COOKIE] Atualizado e salvo em arquivo');
  }
  res.json({ ok: true, message: 'Cookie salvo!' });
});

app.get('/cookie', (req, res) => {
  res.json({ ok: !!cookieSalvo, phpsessid: cookieSalvo || null });
});

// ── LOGIN AUTOMÁTICO NO NEXTSITE (duas etapas) ──
app.post('/login-nextsite', async (req, res) => {
  const { user, pass } = req.body;
  if (!user || !pass) return res.status(400).json({ ok: false, erro: 'user e pass são obrigatórios' });

  const UA = HEADERS['User-Agent'];
  let jar = {};

  try {
    // 1. GET login.php — captura cookie inicial de sessão
    const r0 = await axios.get(`${NEXT_BASE}/login.php`, {
      headers: { 'User-Agent': UA },
      maxRedirects: 0,
      validateStatus: s => s < 500,
      timeout: 10000,
    });
    jar = parseCookies(r0.headers['set-cookie']);
    console.log(`[LOGIN] 1/4 GET login.php → HTTP ${r0.status}`);

    // 2. POST etapa 1: login do jornal
    const r1 = await axios.post(`${NEXT_BASE}/login.php`,
      new URLSearchParams({ login_empresa: NEXT_JORNAL_LOGIN, senha_empresa: NEXT_JORNAL_SENHA }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          'Referer': `${NEXT_BASE}/login.php`,
          'Cookie': cookiesToStr(jar),
        },
        maxRedirects: 0,
        validateStatus: s => s < 500,
        timeout: 10000,
      }
    );
    jar = { ...jar, ...parseCookies(r1.headers['set-cookie']) };
    console.log(`[LOGIN] 2/4 POST login.php → HTTP ${r1.status} | Location: ${r1.headers.location || '—'}`);
    if (r1.status !== 302) {
      return res.status(401).json({ ok: false, erro: 'Login do jornal falhou — credenciais do servidor incorretas' });
    }

    // 3. GET login_cms.php — página do segundo login
    const r2 = await axios.get(`${NEXT_BASE}/login_cms.php`, {
      headers: { 'User-Agent': UA, 'Cookie': cookiesToStr(jar) },
      maxRedirects: 0,
      validateStatus: s => s < 500,
      timeout: 10000,
    });
    jar = { ...jar, ...parseCookies(r2.headers['set-cookie']) };
    console.log(`[LOGIN] 3/4 GET login_cms.php → HTTP ${r2.status}`);

    // 4. POST etapa 2: login pessoal
    const r3 = await axios.post(`${NEXT_BASE}/login_cms.php`,
      new URLSearchParams({ login: user, senha: pass }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          'Referer': `${NEXT_BASE}/login_cms.php`,
          'Cookie': cookiesToStr(jar),
        },
        maxRedirects: 0,
        validateStatus: s => s < 500,
        timeout: 15000,
      }
    );
    jar = { ...jar, ...parseCookies(r3.headers['set-cookie']) };
    const location = (r3.headers.location || '').toLowerCase();
    console.log(`[LOGIN] 4/4 POST login_cms.php → HTTP ${r3.status} | Location: ${r3.headers.location || '—'}`);

    const phpsessid = jar['PHPSESSID'];
    if (!phpsessid || location.includes('login')) {
      console.error(`[LOGIN] ❌ Falhou — PHPSESSID: ${phpsessid ? 'ok' : 'ausente'} | redirect login: ${location.includes('login')}`);
      return res.status(401).json({ ok: false, erro: 'Login pessoal falhou — usuário ou senha incorretos' });
    }

    cookieSalvo = phpsessid;
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({ phpsessid }));
    console.log(`[LOGIN] ✅ Login completo — PHPSESSID: ${phpsessid.substring(0, 8)}...`);
    res.json({ ok: true, message: 'Login feito com sucesso! 🌸' });

  } catch(e) {
    console.error('[LOGIN] Erro:', e.message);
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── MATÉRIAS ──
app.get('/materias', async (req, res) => {
  try {
    const body = {
      operationName: 'Contents',
      query: `query Contents($classification: String!, $tag: String, $limit: Int, $page: Int) {
        contents(classification: $classification, tag: $tag, limit: $limit, page: $page) {
          ... on ArticleContent {
            headline { text }
            published_timestamp
            authors { name }
            img { src }
            links { canonical }
          }
        }
      }`,
      variables: {
        classification: 'clicrbs-rs/gauchazh/esportes',
        tag: 'estadao-conteudo',
        limit: 20,
        page: 1,
      },
    };
    console.log('[MATÉRIAS] Buscando artigos...');
    const r = await comRetry(() => axios.post(GRAPHQL_URL, body, { headers: HEADERS, timeout: 25000 }));
    const materias = (r.data?.data?.contents || []).map(item => ({
      titulo: sanitizar(item.headline?.text || ''),
      link: item.links?.canonical || '',
      tempo: formatarData(item.published_timestamp),
      autor: item.authors?.[0]?.name || '',
    }));
    console.log(`[MATÉRIAS] ${materias.length} artigos retornados`);
    res.json({ ok: true, total: materias.length, materias });
  } catch (e) {
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

const cacheMaterias = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// ── MATÉRIA COMPLETA ──
app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  const cached = cacheMaterias.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[MATÉRIA] Cache: ${url}`);
    return res.json(cached.data);
  }

  console.log(`[MATÉRIA] Scraping: ${url}`);

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
  ];

  let response = null;
  try {
    response = await comRetry(() => Promise.any(userAgents.map(ua =>
      axios.get(url, {
        headers: { 'User-Agent': ua, 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': 'https://www.google.com/' },
        timeout: 25000,
        maxRedirects: 5,
      })
    )));
  } catch (e) {
    return res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }

  try {
    const $ = cheerio.load(response.data);
    const titulo = $('h1').first().text().trim();

    $('script,style,nav,header,footer,aside,figure,figcaption').remove();
    $('[class*="ad"],[class*="banner"],[class*="related"],[class*="newsletter"],[class*="paywall"]').remove();
    let paragrafos = [];
    for (const sel of ['article p','[class*="article"] p','[class*="content"] p','main p','p']) {
      const encontrados = [];
      $(sel).each((i, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 40 && !txt.includes('©') && !txt.includes('Todos os direitos')) encontrados.push(txt);
      });
      if (encontrados.length >= 3) { paragrafos = encontrados; break; }
    }
    const texto = [...new Set(paragrafos)].join('\n\n');

    let autor = '';
    try {
      const isoMatch = response.data.match(/ISOMORPHIC_DATA__="([^"]{100,})"/);
      if (isoMatch) {
        const decoded = decodeURIComponent(isoMatch[1]);
        const compMatch = decoded.match(/"authors_complement":"(\{[^}]*\})"/);
        if (compMatch) {
          const obj = JSON.parse(compMatch[1].replace(/\\"/g, '"'));
          const nomes = Object.values(obj).filter(v => typeof v === 'string' && v.length > 1);
          if (nomes.length) autor = nomes[0];
        }
      }
    } catch {}

    const result = { ok: true, titulo: sanitizar(titulo), texto: sanitizar(texto), autor: sanitizar(autor) };
    cacheMaterias.set(url, { ts: Date.now(), data: result });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── UPLOAD DE FOTO ──
// Recebe fotoUrl, titulo, nomeFoto e apiKey (opcional, para Claude Vision)
app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo, nomeFoto, descricaoFoto, apiKey } = req.body;

  if (!fotoUrl || !titulo) {
    return res.status(400).json({ ok: false, erro: 'fotoUrl e titulo são obrigatórios' });
  }
  // Se não tem cookie local, tenta buscar do Render (bookmarklet salva lá via HTTPS)
  if (!cookieSalvo) {
    try {
      console.log('[COOKIE] Não encontrado localmente, buscando do Render...');
      const r = await axios.get('https://duda-news-server.onrender.com/cookie', { timeout: 5000 });
      if (r.data?.phpsessid) {
        cookieSalvo = r.data.phpsessid;
        console.log('[COOKIE] Obtido do Render com sucesso');
      }
    } catch (e) {
      console.warn('[COOKIE] Falhou ao buscar do Render:', e.message);
    }
  }
  if (!cookieSalvo) {
    return res.status(401).json({ ok: false, erro: 'Cookie não encontrado. Abra o NextSite com o favorito Tanaka Sports primeiro!' });
  }

  // Testa se a sessão do NextSite ainda é válida antes de tentar o upload
  console.log(`[COOKIE] Usando sessão: ${cookieSalvo.substring(0, 8)}... (${cookieSalvo.length} chars)`);
  try {
    const teste = await axios.get('https://admin-dc4.nextsite.com.br/t53kx1_admin/dashboard/', {
      headers: { 'Cookie': `PHPSESSID=${cookieSalvo}`, 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000,
      maxRedirects: 0,
      validateStatus: s => s < 500,
    });
    if (teste.status === 302 || teste.status === 301) {
      console.error('[COOKIE] ❌ Sessão expirada — fazendo login automático...');
      cookieSalvo = null;
      try { fs.unlinkSync(COOKIE_FILE); } catch {}
      try {
        await fazerLoginAuto();
      } catch (loginErr) {
        console.error('[LOGIN-AUTO] ❌ Falhou:', loginErr.message);
        return res.status(401).json({ ok: false, erro: 'Sessão expirada e login automático falhou. Abra o NextSite manualmente.' });
      }
    }
    console.log(`[COOKIE] ✅ Sessão válida (HTTP ${teste.status})`);
  } catch (e) {
    console.warn(`[COOKIE] Aviso: não foi possível verificar sessão (${e.message}) — tentando upload mesmo assim`);
  }

  const phpSessionId = cookieSalvo;

  // Nome do arquivo: usa nomeFoto enviado pelo app (já é slug), ou gera a partir do título
  const nomeSlug = nomeFoto ? toSlug(nomeFoto) : toSlug(gerarLegenda(titulo));

  // Legenda que aparece no NextSite — usa nomeFoto com espaços, ou gera a partir do título
  const legendaExibicao = nomeFoto
    ? nomeFoto.replace(/-/g, ' ')
    : gerarLegenda(titulo);

  try {
    // 1. Faz o download da imagem no servidor (evita bloqueio de CORS no celular)
    // Revalida URL antes de baixar — Google URLs podem expirar (#5)
    try {
      const head = await axios.head(fotoUrl, { timeout: 5000, headers: { 'Referer': 'https://www.google.com/' } });
      const tamanho = parseInt(head.headers['content-length'] || '0');
      if (head.status >= 400) throw new Error(`HTTP ${head.status}`);
      if (tamanho > 0 && tamanho < 5000) throw new Error(`Imagem muito pequena (${tamanho} bytes)`);
      console.log(`[UPLOAD] ✅ URL válida (HTTP ${head.status})`);
    } catch (e) {
      console.warn(`[UPLOAD] ⚠️ Aviso na validação da URL: ${e.message} — tentando mesmo assim`);
    }
    // Verifica se o Tampermonkey já baixou a imagem no navegador (contorna hotlinking)
    const prefetch = imagensPrefetch.get(fotoUrl);
    let imgRes;
    if (prefetch && prefetch.b64) {
      console.log(`[UPLOAD] 1/4 ✅ Usando bytes pré-baixados pelo Tampermonkey (${Math.round(prefetch.b64.length * 0.75 / 1024)}KB estimado)`);
      imagensPrefetch.delete(fotoUrl); // libera memória após uso
      const buf = Buffer.from(prefetch.b64, 'base64');
      imgRes = { data: buf, headers: { 'content-type': prefetch.ct || 'image/jpeg' } };
    } else {
      console.log(`[UPLOAD] 1/4 Baixando imagem: ${fotoUrl.substring(0, 80)}...`);
      imgRes = await comRetry(() => axios.get(fotoUrl, {
        responseType: 'arraybuffer',
        timeout: 35000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.google.com/',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Connection': 'keep-alive',
        },
      }));
      console.log(`[UPLOAD] 1/4 ✅ Imagem baixada: ${Math.round(imgRes.data.byteLength/1024)}KB`);
    }

    // 2. Determina extensão pelo Content-Type
    const ct = imgRes.headers['content-type'] || 'image/jpeg';
    let ext = 'jpg';
    if (ct.includes('png')) ext = 'png';
    else if (ct.includes('gif')) ext = 'gif';
    else if (ct.includes('webp')) ext = 'webp';

    const nomeArquivo = `${nomeSlug}.${ext}`;
    console.log(`[UPLOAD] 2/4 Arquivo: ${nomeArquivo} | Tipo: ${ct.split(';')[0]}}`);

    // 2.5. Gera legenda com Claude Vision + texto em paralelo
    let legendaFinal = legendaExibicao;
    if (descricaoFoto) {
      legendaFinal = descricaoFoto;
      console.log(`[LEGENDA] 📝 Usando descrição manual do app: "${legendaFinal}"`);
    } else if (!apiKey) {
      console.log('[LEGENDA] apiKey não recebida — usando fallback');
    }
    if (!descricaoFoto && apiKey) {
      try {
        const imgBytes = imgRes.data.byteLength || imgRes.data.length || 0;
        const imgKB = Math.round(imgBytes / 1024);
        const mimeBase = ct.split(';')[0].trim().toLowerCase();
        const mediaType = ['image/png','image/webp','image/gif'].includes(mimeBase) ? mimeBase : 'image/jpeg';
        const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };

        // Vision só roda se a imagem for <= 1.5MB (base64 ficaria ~2MB)
        const LIMITE_VISION_KB = 1500;
        const usarVision = imgKB <= LIMITE_VISION_KB;
        console.log(`[LEGENDA] Imagem: ${imgKB}KB (${mediaType}) — Vision: ${usarVision ? 'sim' : 'NÃO (muito grande)'}`);

        const chamarTexto = () => axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 40,
          messages: [{ role: 'user', content: `Com base neste título de matéria esportiva, crie uma legenda curta de até 8 palavras em português para a foto. Sem pontuação no final.\n\nTítulo: "${titulo}"` }],
        }, { headers, timeout: 9000 });

        let promessaVision;
        if (usarVision) {
          const base64Img = Buffer.from(imgRes.data).toString('base64');
          promessaVision = axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 40,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Img } },
              { type: 'text', text: `Matéria: "${titulo}"\n\nDescreva esta foto esportiva em até 8 palavras em português. Use o contexto da matéria para identificar times e jogadores. Sem pontuação no final. Exemplo: Jogadores do Flamengo comemoram vitória` }
            ]}],
          }, { headers, timeout: 15000 });
        } else {
          promessaVision = Promise.reject(new Error('Imagem muito grande — Vision pulado'));
        }

        const [resVision, resTexto] = await Promise.allSettled([promessaVision, chamarTexto()]);

        const legVision = resVision.status === 'fulfilled' ? limparLegenda(resVision.value.data.content[0].text) : null;
        const legTexto  = resTexto.status  === 'fulfilled' ? limparLegenda(resTexto.value.data.content[0].text)  : null;

        if (legVision) console.log(`[LEGENDA] 📷 Vision OK: "${legVision}"`);
        else {
          let err = resVision.reason?.message || 'erro desconhecido';
          if (resVision.reason?.response?.data) {
            try { const d = resVision.reason.response.data; err = typeof d === 'object' ? JSON.stringify(d).substring(0, 300) : String(d).substring(0, 300); } catch {}
          }
          console.warn(`[LEGENDA] 📷 Vision falhou: ${err}`);
        }
        if (legTexto) console.log(`[LEGENDA] 📝 Texto OK: "${legTexto}"`);
        else console.warn(`[LEGENDA] 📝 Texto falhou: ${resTexto.reason?.message}`);

        if (legVision && legTexto) {
          // Ambos funcionaram — combina as duas informações numa 3ª chamada rápida
          try {
            const resCombinar = await axios.post('https://api.anthropic.com/v1/messages', {
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 40,
              messages: [{ role: 'user', content:
                `Você tem duas descrições de uma foto esportiva e o título da matéria. Combine as informações para criar UMA legenda única de até 8 palavras em português. Use nomes próprios e contexto do título quando souber. Sem pontuação no final.\n\nTítulo: "${titulo}"\nO que aparece na foto: "${legVision}"\nContexto da matéria: "${legTexto}"\n\nLegenda:`
              }],
            }, { headers, timeout: 8000 });
            const legCombinada = limparLegenda(resCombinar.data.content[0].text);
            if (legCombinada) {
              console.log(`[LEGENDA] 🔀 Combinada: "${legCombinada}"`);
              legendaFinal = legCombinada;
            } else {
              legendaFinal = legVision;
            }
          } catch(eComb) {
            console.warn(`[LEGENDA] 🔀 Combinar falhou: ${eComb.message} — usando Vision`);
            legendaFinal = legVision;
          }
        } else if (legVision) {
          legendaFinal = legVision;
        } else if (legTexto) {
          legendaFinal = legTexto;
        }

        if (legendaFinal !== legendaExibicao) {
          console.log(`[LEGENDA] ✅ Usando: "${legendaFinal}"`);
        } else {
          console.warn('[LEGENDA] ⚠️ Todos falharam — usando nome abreviado');
        }
      } catch(e) {
        console.warn('[LEGENDA] Erro inesperado:', e.message);
      }
    }

    // 3. Monta o FormData e envia ao NextSite
    console.log(`[UPLOAD] 3/4 Montando FormData com legenda: "${legendaFinal}"`);
    const form = new FormData();
    form.append('files[]', Buffer.from(imgRes.data), {
      filename: nomeArquivo,
      contentType: ct,
    });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', legendaFinal);
    form.append('credito_wda[0]', '');
    form.append('descricao_wda[0]', legendaFinal);
    form.append('keyword_wda[0]', '');
    form.append('transparencia_wda[0]', '0');
    form.append('publica[0]', '1');

    let uploadRes;
    const uploadInicio = Date.now();
    console.log(`[UPLOAD] Enviando "${nomeArquivo}" (${Math.round(imgRes.data.byteLength/1024)}KB) para o NextSite...`);
    try {
      uploadRes = await comRetry(() => axios.post(
        'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/jquery-upload/jqueryupload.php',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Cookie': `PHPSESSID=${phpSessionId}`,
            'Referer': 'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/novo.php?empresa=1&parent=6',
            'Origin': 'https://admin-dc4.nextsite.com.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Connection': 'keep-alive',
          },
          timeout: 35000,
        }
      ));
    } catch (uploadErr) {
      const status = uploadErr.response?.status;
      const tempo = ((Date.now() - uploadInicio) / 1000).toFixed(1);
      console.error(`[UPLOAD] ❌ Falhou em ${tempo}s | código: ${uploadErr.code || 'N/A'} | status HTTP: ${status || 'N/A'} | erro: ${uploadErr.message}`);
      if (uploadErr.response?.data) {
        try { console.error(`[UPLOAD] Resposta NextSite: ${JSON.stringify(uploadErr.response.data).substring(0, 300)}`); } catch {}
      }
      if (status === 403 || status === 401) {
        return res.status(401).json({ ok: false, erro: 'Cookie expirado. Renove o cookie e tente de novo.' });
      }
      throw uploadErr;
    }

    const tempo = ((Date.now() - uploadInicio) / 1000).toFixed(1);
    console.log(`[UPLOAD] ✅ Foto enviada em ${tempo}s: ${nomeArquivo} → HTTP ${uploadRes.status}`);
    try { console.log(`[UPLOAD] Resposta NextSite: ${JSON.stringify(uploadRes.data).substring(0, 200)}`); } catch {}

    res.json({ ok: true, message: 'Foto enviada!', nomeArquivo, legendaExibicao, legendaFinal });

  } catch (e) {
    console.error(`[UPLOAD] Erro: ${e.message}`);
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── SELEÇÃO AUTOMÁTICA DE FOTO ──
// Recebe candidatas do Google Imagens, Claude escolhe a melhor pelo índice e gera legenda inicial
app.post('/escolher-foto', async (req, res) => {
  const { urls, titulo, query, apiKey } = req.body;
  if (!urls?.length || !titulo || !apiKey) {
    return res.status(400).json({ ok: false, erro: 'urls, titulo e apiKey obrigatórios' });
  }

  const MAX_FOTOS    = 6;
  const MAX_TOKENS   = 120;
  const TIMEOUT_DL   = 6000;
  const TIMEOUT_GLOB = 15000;

  // Pré-filtro sem download — elimina logos e formatos inúteis pela URL
  const filtradas = urls.filter(url => {
    if (!/^https?:\/\//i.test(url)) return false;
    if (/logo|escudo|crest|badge|icon|avatar|spinner|placeholder/i.test(url)) return false;
    if (/\.(gif|svg|ico)(\?|$)/i.test(url)) return false;
    return true;
  }).slice(0, MAX_FOTOS);

  if (filtradas.length === 0) {
    return res.status(422).json({ ok: false, erro: 'Nenhuma URL passou no filtro' });
  }

  console.log(`[FOTO] 🔍 Analisando ${filtradas.length} candidatas para: "${titulo.substring(0, 50)}"`);

  try {
    // Timeout global — evita travar o servidor inteiro (#4)
    const baixarTodas = Promise.allSettled(filtradas.map(url =>
      axios.get(url, {
        responseType: 'arraybuffer',
        timeout: TIMEOUT_DL,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.google.com/',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
      })
    ));
    const downloads = await Promise.race([
      baixarTodas,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout global de downloads')), TIMEOUT_GLOB)),
    ]);

    // Monta lista apenas com os downloads que funcionaram
    const imagensOk = downloads
      .map((r, i) => ({ resultado: r, url: filtradas[i] }))
      .filter(x => x.resultado.status === 'fulfilled')
      .map(x => {
        const ct = (x.resultado.value.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
        const mediaType = ['image/png', 'image/webp', 'image/gif'].includes(ct) ? ct : 'image/jpeg';
        const base64 = Buffer.from(x.resultado.value.data).toString('base64');
        return { url: x.url, mediaType, base64 };
      });

    if (imagensOk.length === 0) {
      return res.status(422).json({ ok: false, erro: 'Não foi possível baixar nenhuma imagem candidata' });
    }

    console.log(`[FOTO] 📥 ${imagensOk.length}/${filtradas.length} imagens baixadas com sucesso`);

    // Monta prompt com critérios explícitos de rejeição (#3)
    const conteudo = [
      ...imagensOk.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
      { type: 'text', text: `Matéria esportiva: "${titulo}"\nBusca usada no Google: "${query || titulo}"\n\nVocê recebeu ${imagensOk.length} foto(s) (índices 0 a ${imagensOk.length - 1}).\n\nEscolha a foto que melhor corresponde à BUSCA ACIMA — pessoa, veículo, evento ou time pesquisado.\n\nREGRA ABSOLUTA — DESCARTE IMEDIATO: ignore qualquer foto que contenha texto visível sobreposto (manchete, legenda, placar, nome de jogador escrito, arte gráfica, banner, infográfico, lista ou qualquer texto sobre a imagem). Fotos com texto NÃO são aceitas sob nenhuma circunstância.\n\nEntre as fotos sem texto, prefira a que corresponde especificamente aos termos da busca.\n\nREJEITE (index:-1) se todas as fotos restantes (sem texto) forem logo, escudo ou de sujeito que não corresponde à busca.\n\nResponda SOMENTE com JSON válido:\n{"index": 0, "legenda": "descrição em até 8 palavras"}\nou se rejeitar:\n{"index": -1, "legenda": ""}` },
    ];

    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: conteudo }],
    }, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 12000,
    });

    const texto = r.data.content[0].text.trim();

    // Parser tolerante — nunca deixa SyntaxError chegar ao cliente (#2)
    let parsed;
    try {
      const match = texto.match(/\{[\s\S]*?\}/);
      parsed = JSON.parse(match?.[0] || '{}');
    } catch {
      console.warn(`[FOTO] Parse falhou, assumindo rejeição. Resposta: ${texto.substring(0, 100)}`);
      parsed = { index: -1, legenda: '' };
    }

    const idx = typeof parsed.index === 'number' ? parsed.index : -1;

    // index: -1 → nenhuma foto adequada, cai no manual
    if (idx === -1) {
      console.log('[FOTO] ⚠️ Claude rejeitou todas as candidatas — grade disponível para seleção manual');
      return res.json({ ok: false, rejeitado: true, erro: 'Nenhuma foto adequada encontrada — escolha manualmente', candidatas: imagensOk.map(x => x.url) });
    }

    if (idx < 0 || idx >= imagensOk.length) {
      throw new Error(`Índice inválido: ${idx} (temos ${imagensOk.length} imagens)`);
    }

    const urlEscolhida = imagensOk[idx].url;
    const legenda = limparLegenda(parsed.legenda || '');
    console.log(`[FOTO] ✅ Escolheu índice ${idx} | legenda: "${legenda}"`);

    // candidatas: URL escolhida primeiro, depois as demais para fallback de download
    const candidatas = [
      urlEscolhida,
      ...imagensOk.filter((_, i) => i !== idx).map(x => x.url),
      ...filtradas.filter(u => !imagensOk.some(x => x.url === u)),
    ];

    res.json({ ok: true, index: 0, url: urlEscolhida, legenda, candidatas });

  } catch (e) {
    const err = e.response?.data ? JSON.stringify(e.response.data).substring(0, 200) : e.message;
    console.warn(`[FOTO] ❌ Seleção automática falhou: ${err}`);
    res.status(500).json({ ok: false, erro: err });
  }
});

// ── PROXY DE IMAGEM (contorna hotlinking e bloqueios de CORS) ──
// O frontend envia a URL original → servidor busca com cabeçalhos de navegador real → devolve os bytes
// Isso contorna sites que bloqueiam downloads diretos pelo servidor (hotlinking) porque o servidor
// imita um usuário navegando no próprio site de origem.
app.get('/proxy-img', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.startsWith('http')) return res.status(400).json({ ok: false, erro: 'URL inválida' });

  // Extrai o domínio da URL para usar como Referer (engana proteção de hotlink)
  let referer = 'https://www.google.com/';
  try { referer = new URL(url).origin + '/'; } catch {}

  const tentativas = [
    // Tentativa 1: se passa como navegador vindo do próprio site
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Referer': referer, 'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8' },
    // Tentativa 2: sem Referer (alguns sites bloqueiam referer externo mas permitem direto)
    { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'Accept': 'image/*,*/*;q=0.8' },
    // Tentativa 3: Googlebot (muitos sites liberam para indexação)
    { 'User-Agent': 'Googlebot-Image/1.0', 'Accept': 'image/*' },
  ];

  for (let i = 0; i < tentativas.length; i++) {
    try {
      const r = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: tentativas[i],
        maxRedirects: 5,
      });
      const ct = r.headers['content-type'] || 'image/jpeg';
      if (!ct.startsWith('image/')) continue; // não é imagem, tenta próximo
      console.log(`[PROXY-IMG] ✅ Tentativa ${i + 1} ok | ${Math.round(r.data.byteLength / 1024)}KB | ${url.substring(0, 70)}`);
      res.set('Content-Type', ct);
      res.set('Cache-Control', 'public, max-age=300');
      return res.send(Buffer.from(r.data));
    } catch (e) {
      console.warn(`[PROXY-IMG] ⚠️ Tentativa ${i + 1} falhou: ${e.message}`);
    }
  }

  console.error(`[PROXY-IMG] ❌ Todas as tentativas falharam: ${url.substring(0, 80)}`);
  res.status(502).json({ ok: false, erro: 'Imagem inacessível após 3 tentativas' });
});

// ── SUGERIR COMPLEMENTO (proxy para API Anthropic) ──
app.post('/sugerir-complemento', async (req, res) => {
  const { titulo, texto, apiKey } = req.body;
  if (!titulo || !apiKey) return res.status(400).json({ ok: false, erro: 'titulo e apiKey são obrigatórios' });
  try {
    const primeiras300 = (texto || '').split(/\s+/).slice(0, 300).join(' ');
    const r = await comRetry(() => axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `Você é editor de um jornal esportivo brasileiro. Com base no título e texto da matéria, crie 3 sugestões de COMPLEMENTO. O complemento é um subtítulo curto que acrescenta contexto ao título principal — NÃO repita o título nem o parafraseie.\n\nRegras:\n- Máximo 100 caracteres cada\n- Em português\n- Sem pontuação no final\n- Foque em fatos específicos da matéria (placar, data, local, detalhe relevante)\n- Cada sugestão diferente das outras\n\nTítulo: "${titulo}"\nTexto: "${primeiras300}"\n\nResponda APENAS com JSON válido: {"sugestoes": ["sugestão 1", "sugestão 2", "sugestão 3"]}` }],
    }, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 25000,
    }));
    const raw = r.data.content[0].text.trim();
    let parsed;
    try { const m = raw.match(/\{[\s\S]*?\}/); parsed = JSON.parse(m?.[0] || '{}'); } catch { parsed = {}; }
    const sugestoes = (parsed.sugestoes || []).map(s => String(s).trim().substring(0, 100)).filter(s => s);
    console.log(`[COMPLEMENTO] ${sugestoes.length} sugestões para: "${titulo.substring(0, 50)}"`);
    res.json({ ok: true, sugestoes });
  } catch(e) {
    console.error('[COMPLEMENTO] Erro:', e.message);
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── SUGERIR LEGENDA DA FOTO ──
app.post('/sugerir-legenda', async (req, res) => {
  const { titulo, legenda, apiKey } = req.body;
  if (!titulo || !apiKey) return res.status(400).json({ ok: false, erro: 'titulo e apiKey são obrigatórios' });
  try {
    const base = legenda ? `\nSugestão inicial da IA: "${legenda}"` : '';
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `Você é editor de um jornal esportivo brasileiro. Crie 3 legendas curtas para a foto de uma matéria esportiva. A legenda aparece abaixo da foto no site.${base}\n\nRegras:\n- Máximo 80 caracteres cada\n- Em português\n- Sem pontuação no final\n- Descreva o que provalmente aparece na foto com base no título\n- Cada sugestão diferente das outras — varie o foco (jogador, ação, time, evento)\n\nTítulo da matéria: "${titulo}"\n\nResponda APENAS com JSON válido: {"sugestoes": ["legenda 1", "legenda 2", "legenda 3"]}` }],
    }, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 25000,
    });
    const raw = r.data.content[0].text.trim();
    let parsed;
    try { const m = raw.match(/\{[\s\S]*?\}/); parsed = JSON.parse(m?.[0] || '{}'); } catch { parsed = {}; }
    const sugestoes = (parsed.sugestoes || []).map(s => String(s).trim().substring(0, 80)).filter(s => s);
    console.log(`[LEGENDA-SUGESTAO] ${sugestoes.length} sugestões para: "${titulo.substring(0, 50)}"`);
    res.json({ ok: true, sugestoes });
  } catch(e) {
    console.error('[LEGENDA-SUGESTAO] Erro:', e.message);
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── SUGERIR LEGENDA COM VISION DA FOTO (descreve a imagem e gera 3 legendas) ──
app.post('/sugerir-legenda-foto', async (req, res) => {
  const { imageUrl, titulo, apiKey } = req.body;
  if (!imageUrl || !titulo || !apiKey) return res.status(400).json({ ok: false, erro: 'imageUrl, titulo e apiKey são obrigatórios' });
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  try {
    // 1. Baixa a imagem e descreve em detalhes com Vision
    let descricaoDetalhada = '';
    try {
      const imgRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer', timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.google.com/', 'Accept': 'image/*' },
      });
      const ct = imgRes.headers['content-type'] || 'image/jpeg';
      const mimeBase = ct.split(';')[0].trim().toLowerCase();
      const mediaType = ['image/png','image/webp','image/gif'].includes(mimeBase) ? mimeBase : 'image/jpeg';
      const imgKB = Math.round(imgRes.data.byteLength / 1024);
      if (imgKB <= 1500) {
        const base64Img = Buffer.from(imgRes.data).toString('base64');
        const resDesc = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-haiku-4-5-20251001', max_tokens: 300,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Img } },
            { type: 'text', text: `Descreva esta foto esportiva com detalhes: quem aparece (jogadores, uniformes, times), o que está acontecendo (ação, comemoração, entrevista), expressões e elementos visuais relevantes. Use o contexto do título para identificar pessoas e times quando possível. Seja objetivo e específico. Máximo 3 frases em português.\n\nTítulo da matéria: "${titulo}"` }
          ]}],
        }, { headers, timeout: 15000 });
        descricaoDetalhada = resDesc.data.content[0].text.trim();
        console.log(`[LEGENDA-FOTO] 📷 Descrição: "${descricaoDetalhada.substring(0, 100)}..."`);
      } else {
        console.log(`[LEGENDA-FOTO] Imagem muito grande (${imgKB}KB) — gerando sem Vision`);
      }
    } catch(e) {
      console.warn('[LEGENDA-FOTO] Falhou ao descrever imagem:', e.message);
    }

    // 2. Gera 3 legendas com base na descrição + título
    const contexto = descricaoDetalhada ? `\nDescrição detalhada da foto: "${descricaoDetalhada}"` : '';
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001', max_tokens: 250,
      messages: [{ role: 'user', content: `Você é editor de um jornal esportivo brasileiro. Crie 3 legendas para a foto de uma matéria esportiva. A legenda aparece abaixo da foto no site.${contexto}\n\nRegras:\n- Máximo 80 caracteres cada\n- Em português do Brasil\n- Sem pontuação no final\n- Cada sugestão deve ser diferente das outras — varie o foco (jogador, ação, time, evento)\n- Quando houver descrição da foto, priorize o que está visível na imagem\n\nTítulo da matéria: "${titulo}"\n\nResponda APENAS com JSON válido: {"sugestoes": ["legenda 1", "legenda 2", "legenda 3"]}` }],
    }, { headers, timeout: 15000 });
    const raw = r.data.content[0].text.trim();
    let parsed;
    try { const m = raw.match(/\{[\s\S]*?\}/); parsed = JSON.parse(m?.[0] || '{}'); } catch { parsed = {}; }
    const sugestoes = (parsed.sugestoes || []).map(s => limparLegenda(String(s))).filter(s => s.length > 0);
    console.log(`[LEGENDA-FOTO] ✅ ${sugestoes.length} sugestões para: "${titulo.substring(0, 50)}"`);
    res.json({ ok: true, sugestoes, descricao: descricaoDetalhada });
  } catch(e) {
    console.error('[LEGENDA-FOTO] Erro:', e.message);
    res.status(500).json({ ok: false, erro: traduzirErro(e), sugestoes: [] });
  }
});

// ── CLASSIFICAR CHAPÉU (proxy para API Anthropic — evita CORS do browser) ──
app.post('/classificar-chapeu', async (req, res) => {
  const { titulo, texto, apiKey } = req.body;
  if (!titulo || !apiKey) return res.status(400).json({ ok: false, erro: 'titulo e apiKey são obrigatórios' });
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: 'Você é um classificador de matérias esportivas para um jornal brasileiro. Responda APENAS com uma opção desta lista exata, sem inventar palavras novas. Escolha a mais específica possível:\n\nFUTEBOL, FUTSAL, FUTEBOL AMERICANO, BASQUETE, VÔLEI, VÔLEI DE PRAIA, TÊNIS, TÊNIS DE MESA, BADMINTON, SQUASH, PADEL, BEACH TENNIS, FÓRMULA 1, AUTOMOBILISMO, RALI, MOTOCICLISMO, MOTO GP, NATAÇÃO, NATAÇÃO ARTÍSTICA, MERGULHO, POLO AQUÁTICO, SURFE, REMO, CANOAGEM, VELA, ATLETISMO, MARATONA, CORRIDA DE RUA, CICLISMO, MOUNTAIN BIKE, BMX, GINÁSTICA ARTÍSTICA, GINÁSTICA RÍTMICA, GINÁSTICA ACROBÁTICA, TRAMPOLIM, SKATE, SNOWBOARD, SKI, PATINAÇÃO, HÓQUEI NO GELO, HÓQUEI NA GRAMA, RUGBY, HANDEBOL, BEISEBOL, SOFTBOL, CRÍQUETE, GOLFE, HIPISMO, PENTATLO MODERNO, TRIATLO, IRONMAN, MMA, UFC, BOXE, KICKBOXING, MUAY THAI, JUDÔ, KARATÊ, TAEKWONDO, WRESTLING, LUTA OLÍMPICA, ESGRIMA, TIRO ESPORTIVO, TIRO COM ARCO, LEVANTAMENTO DE PESO, HALTEROFILISMO, CROSSFIT, ESCALADA, PARAOLIMPÍADAS, ESPORTS.\n\nSe o esporte não estiver na lista escolha o mais próximo. NUNCA invente palavras. Responda SOMENTE com uma opção da lista, sem explicação, sem pontuação extra.',
      messages: [{ role: 'user', content: `Título: ${titulo}\nTexto: ${(texto || '').substring(0, 500)}` }],
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 25000,
    });
    const chapeu = r.data.content[0].text.trim();
    console.log(`[CHAPÉU] ${chapeu} ← "${titulo.substring(0, 50)}"`);
    res.json({ ok: true, chapeu });
  } catch(e) {
    console.error('[CHAPÉU] Erro:', e.message);
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── ABRE QUALQUER URL NO CHROME DO PC (Google Imagens, NextSite, etc) ──
app.post('/query-foto', async (req, res) => {
  const { titulo, apiKey } = req.body;
  if (!titulo) return res.status(400).json({ ok: false, erro: 'titulo obrigatório' });
  if (!apiKey) return res.json({ ok: true, query: titulo });
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{ role: 'user', content: `Título de matéria esportiva brasileira: "${titulo}"\n\nExtraia 3 a 5 termos para buscar uma foto no Google Imagens. Priorize nomes de times, atletas e competição. Retorne APENAS os termos separados por espaço, sem pontuação, sem explicação.` }],
    }, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 8000,
    });
    const query = r.data?.content?.[0]?.text?.trim() || titulo;
    console.log(`[QUERY-FOTO] "${titulo}" → "${query}"`);
    res.json({ ok: true, query });
  } catch (e) {
    console.warn('[QUERY-FOTO] Erro IA, usando título:', e.message);
    res.json({ ok: true, query: titulo });
  }
});

app.get('/abrir-google', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });
  const urlSegura = url.replace(/[;$|`()"\\]/g, '');
  console.log(`[CHROME] Abrindo no PC: ${urlSegura.substring(0, 100)}`);
  exec(`start chrome "${urlSegura}"`, err => {
    if (err) {
      exec(`start msedge "${urlSegura}"`, err2 => {
        if (err2) console.warn('[CHROME] Edge falhou:', err2.message);
      });
    }
  });
  res.json({ ok: true });
});

// ── DIAGNÓSTICO DOM do Google Imagens ──
app.post('/diagnostico', (req, res) => {
  console.log('[DIAG] ════════════════════════════════');
  Object.entries(req.body).forEach(([k, v]) => console.log(`[DIAG] ${k}: ${v}`));
  console.log('[DIAG] ════════════════════════════════');
  res.json({ ok: true });
});

// ── GOOGLE IMAGENS (relay Tampermonkey → app) ──
let googleImagensCache = [];
// Mapa de URL → { b64, ct } pré-baixados pelo Tampermonkey no navegador
const imagensPrefetch = new Map();

app.post('/google-imagens', (req, res) => {
  googleImagensCache = req.body.urls || [];
  // Tampermonkey pode enviar os bytes de cada imagem já baixados no navegador
  const imagens = req.body.imagens || {};
  let comBytes = 0;
  for (const [url, dado] of Object.entries(imagens)) {
    if (dado && dado.b64) { imagensPrefetch.set(url, dado); comBytes++; }
  }
  console.log(`[FOTOS] 📥 Tampermonkey enviou ${googleImagensCache.length} URLs | ${comBytes} com bytes pré-baixados`);
  if (googleImagensCache.length) googleImagensCache.forEach((u, i) => console.log(`[FOTOS]   ${i + 1}: ${u.substring(0, 80)}`));
  res.json({ ok: true });
});
app.get('/google-imagens', (req, res) => {
  const urls = googleImagensCache;
  googleImagensCache = [];
  if (urls.length) console.log(`[FOTOS] 📤 App buscou cache — entregando ${urls.length} URLs`);
  else console.log('[FOTOS] 📭 App buscou cache — estava vazio');
  res.json({ urls });
});

// ── FOTO ENVIADA (relay app → Tampermonkey para fechar aba Google) ──
let fotoEnviadaFlag = false;
app.post('/foto-enviada', (req, res) => {
  fotoEnviadaFlag = true;
  console.log('[FOTOS] ✅ App sinalizou: foto enviada ao NextSite');
  res.json({ ok: true });
});
app.get('/foto-enviada', (req, res) => {
  const foi = fotoEnviadaFlag;
  fotoEnviadaFlag = false;
  res.json({ foi });
});

// ── PUBLICAR STATUS (relay Tampermonkey → app) ──
let publicarStatusCache = null;
app.post('/publicar-status', (req, res) => {
  publicarStatusCache = { ok: req.body.ok === true, titulo: req.body.titulo || '', ts: Date.now() };
  console.log(`[PUBLICAR] ✅ Tampermonkey confirmou publicação: "${publicarStatusCache.titulo.substring(0, 60)}"`);
  res.json({ ok: true });
});
app.get('/publicar-status', (req, res) => {
  const status = publicarStatusCache;
  publicarStatusCache = null;
  res.json(status || { ok: null });
});

// ── PUBLICAÇÃO PENDENTE (recuperação após login durante publicar) ──
let publicacaoPendente = null;
app.post('/salvar-publicacao', (req, res) => {
  const { url } = req.body;
  if (url) { publicacaoPendente = url; console.log('[PUBLICAR] 📌 URL pendente salva para recuperação pós-login'); }
  res.json({ ok: true });
});
app.get('/publicacao-pendente', (req, res) => {
  const url = publicacaoPendente;
  publicacaoPendente = null;
  res.json({ ok: !!url, url: url || null });
});

// ── FEEDBACK DA USUÁRIA ──
let feedbackArmazenado = [];
app.post('/feedback', (req, res) => {
  const { mensagem } = req.body;
  if (!mensagem?.trim()) return res.status(400).json({ ok: false, erro: 'Mensagem vazia' });
  const item = {
    id: Date.now(),
    ts: new Date().toLocaleString('pt-BR'),
    mensagem: mensagem.trim().substring(0, 1000),
  };
  feedbackArmazenado.push(item);
  console.log(`[FEEDBACK] 📩 ${item.ts} — "${item.mensagem.substring(0, 150)}"`);
  res.json({ ok: true });
});
app.get('/feedback', (req, res) => {
  res.json({ ok: true, total: feedbackArmazenado.length, mensagens: feedbackArmazenado });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));

// ── Evita que o servidor caia por erros inesperados ──
process.on('uncaughtException', (err) => {
  console.error(`[FATAL] Erro não capturado: ${err.message}`);
  console.error(err.stack?.substring(0, 500));
});
process.on('unhandledRejection', (reason) => {
  console.error(`[FATAL] Promise rejeitada: ${reason?.message || reason}`);
});
