const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());
const path2 = require('path');
app.get('/app', (req, res) => {
  res.sendFile(path2.join(__dirname, 'app-duda.html'));
});

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const GRAPHQL_URL = 'https://gauchazh.clicrbs.com.br/graphql?v=2';

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

// Cada IP tem seu próprio cookie de sessão — evita conflito entre usuários
const sessoes = new Map();

// ── HOME ──
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

// ── COOKIE ──
app.post('/cookie', (req, res) => {
  const { phpsessid } = req.body;
  if (!phpsessid) return res.status(400).json({ ok: false, erro: 'Cookie não informado' });
  const ip = req.ip || req.socket.remoteAddress;
  sessoes.set(ip, phpsessid);
  console.log(`[COOKIE] Sessão salva para ${ip}`);
  res.json({ ok: true, message: 'Cookie salvo!' });
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
    const r = await axios.post(GRAPHQL_URL, body, { headers: HEADERS, timeout: 15000 });
    const materias = (r.data?.data?.contents || []).map(item => ({
      titulo: sanitizar(item.headline?.text || ''),
      link: item.links?.canonical || '',
      tempo: formatarData(item.published_timestamp),
      autor: item.authors?.[0]?.name || '',
    }));
    console.log(`[MATÉRIAS] ${materias.length} artigos retornados`);
    res.json({ ok: true, total: materias.length, materias });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
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
    response = await Promise.any(userAgents.map(ua =>
      axios.get(url, {
        headers: { 'User-Agent': ua, 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': 'https://www.google.com/' },
        timeout: 10000,
        maxRedirects: 5,
      })
    ));
  } catch {
    return res.status(500).json({ ok: false, erro: 'Não foi possível acessar a matéria' });
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
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ── UPLOAD DE FOTO ──
// Recebe fotoUrl, titulo e nomeFoto (customizado pelo app)
app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo, nomeFoto } = req.body;

  if (!fotoUrl || !titulo) {
    return res.status(400).json({ ok: false, erro: 'fotoUrl e titulo são obrigatórios' });
  }
  const ip = req.ip || req.socket.remoteAddress;
  const phpSessionId = sessoes.get(ip);
  if (!phpSessionId) {
    return res.status(401).json({ ok: false, erro: 'Cookie não encontrado. Abra o NextSite com o favorito Tanaka Sports primeiro!' });
  }

  // Nome do arquivo: usa nomeFoto enviado pelo app (já é slug), ou gera a partir do título
  const nomeSlug = nomeFoto ? toSlug(nomeFoto) : toSlug(gerarLegenda(titulo));

  // Legenda que aparece no NextSite — usa nomeFoto com espaços, ou gera a partir do título
  const legendaExibicao = nomeFoto
    ? nomeFoto.replace(/-/g, ' ')
    : gerarLegenda(titulo);

  try {
    // 1. Faz o download da imagem no servidor (evita bloqueio de CORS no celular)
    const imgRes = await axios.get(fotoUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.google.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    // 2. Determina extensão pelo Content-Type
    const ct = imgRes.headers['content-type'] || 'image/jpeg';
    let ext = 'jpg';
    if (ct.includes('png')) ext = 'png';
    else if (ct.includes('gif')) ext = 'gif';
    else if (ct.includes('webp')) ext = 'webp';

    const nomeArquivo = `${nomeSlug}.${ext}`;

    // 3. Monta o FormData e envia ao NextSite
    const form = new FormData();
    form.append('files[]', Buffer.from(imgRes.data), {
      filename: nomeArquivo,
      contentType: ct,
    });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', legendaExibicao);    // legenda que aparece no jornal
    form.append('credito_wda[0]', 'Estadão Conteúdo');
    form.append('descricao_wda[0]', titulo);
    form.append('keyword_wda[0]', '');
    form.append('transparencia_wda[0]', '0');
    form.append('publica[0]', '1');

    const uploadRes = await axios.post(
      'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/jquery-upload/jqueryupload.php',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Cookie': `PHPSESSID=${phpSessionId}`,
          'Referer': 'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/novo.php?empresa=1&parent=6',
          'Origin': 'https://admin-dc4.nextsite.com.br',
        },
        timeout: 30000,
      }
    );

    // Loga a resposta do NextSite para debug
    console.log(`[UPLOAD] Foto enviada: ${nomeArquivo} → status ${uploadRes.status}`);

    res.json({ ok: true, message: 'Foto enviada!', nomeArquivo, legendaExibicao });

  } catch (e) {
    console.error(`[UPLOAD] Erro: ${e.message}`);
    // Detalha o erro para a Duda ver no app
    let mensagem = e.message;
    if (e.response) {
      mensagem = `Erro ${e.response.status} do NextSite`;
    } else if (e.code === 'ECONNABORTED') {
      mensagem = 'Timeout — imagem demorou demais para baixar';
    }
    res.status(500).json({ ok: false, erro: mensagem });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));
