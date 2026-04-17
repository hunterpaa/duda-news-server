const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());

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
  const demais   = palavras.filter(p => !/^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  return [...new Set([...proprias, ...demais])].slice(0, 5).join(' ');
}

// ── Gera legenda curta descritiva sem precisar de API externa ──
// Ex: "Flamengo x Independiente Medellín pela Libertadores"
// → "Flamengo Independiente Medellin Libertadores"
function gerarLegenda(titulo) {
  // Pega os 4 nomes próprios mais relevantes do título
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
  // Pega até 4 nomes próprios para legenda concisa
  return [...new Set(proprias)].slice(0, 4).join(' ') || extrairPalavrasChave(titulo);
}

let phpSessionId = '';

// ── HOME ──
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

// ── COOKIE ──
app.post('/cookie', (req, res) => {
  const { phpsessid } = req.body;
  if (!phpsessid) return res.status(400).json({ ok: false, erro: 'Cookie não informado' });
  phpSessionId = phpsessid;
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
        limit: 20, page: 1,
      },
    };
    const r = await axios.post(GRAPHQL_URL, body, { headers: HEADERS, timeout: 15000 });
    const materias = (r.data?.data?.contents || []).map(item => ({
      titulo: sanitizar(item.headline?.text || ''),
      link:   item.links?.canonical || '',
      tempo:  formatarData(item.published_timestamp),
      autor:  item.authors?.[0]?.name || '',
    }));
    res.json({ ok: true, total: materias.length, materias });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ── MATÉRIA COMPLETA ──
app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
  ];

  let response = null;
  for (const ua of userAgents) {
    try {
      response = await axios.get(url, {
        headers: { 'User-Agent': ua, 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': 'https://www.google.com/' },
        timeout: 15000, maxRedirects: 5,
      });
      if (response.status === 200) break;
    } catch (e) { continue; }
  }

  if (!response) return res.status(500).json({ ok: false, erro: 'Não foi possível acessar a matéria' });

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
        if (txt.length > 40 && !txt.includes('©') && !txt.includes('Todos os direitos'))
          encontrados.push(txt);
      });
      if (encontrados.length >= 3) { paragrafos = encontrados; break; }
    }

    const texto = [...new Set(paragrafos)].join('\n\n');
    res.json({ ok: true, titulo: sanitizar(titulo), texto: sanitizar(texto) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ── UPLOAD DE FOTO ──
// Legenda gerada automaticamente a partir dos nomes próprios do título
// Ex: "Conmebol divulga áudio VAR Palmeiras" → "Conmebol VAR Palmeiras"
app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo } = req.body;

  if (!fotoUrl || !titulo)
    return res.status(400).json({ ok: false, erro: 'fotoUrl e titulo são obrigatórios' });

  if (!phpSessionId)
    return res.status(401).json({ ok: false, erro: 'Cookie não encontrado. Abra o NextSite com o favorito Tanaka Sports primeiro!' });

  // Legenda curta — nomes próprios do título (times, jogadores, competições)
  const legendaCurta = gerarLegenda(titulo);
  const nomeSlug = legendaCurta
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

  try {
    const imgRes = await axios.get(fotoUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.google.com/' },
    });

    const ct  = imgRes.headers['content-type'] || 'image/jpeg';
    const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : 'jpg';

    const form = new FormData();
    form.append('files[]', Buffer.from(imgRes.data), { filename: `${nomeSlug}.${ext}`, contentType: ct });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', legendaCurta);   // legenda curta — aparece no jornal
    form.append('credito_wda[0]', 'Estadão Conteúdo');
    form.append('descricao_wda[0]', titulo);
    form.append('keyword_wda[0]', '');
    form.append('transparencia_wda[0]', '0');
    form.append('publica[0]', '1');

    await axios.post(
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

    res.json({ ok: true, message: 'Foto enviada!', legendaCurta });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));
