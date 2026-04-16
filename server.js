const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const GRAPHQL_URL = 'https://gauchazh.clicrbs.com.br/graphql?v=2';

const GRAPHQL_QUERY = `query Contents($classification: String!, $tag: String, $limit: Int, $page: Int) {
  contents(classification: $classification, tag: $tag, limit: $limit, page: $page) {
    ... on ArticleContent {
      headline { text }
      published_timestamp
      authors { name }
      img { src }
      links { canonical path }
    }
  }
}`;

async function buscarMateriasDaAPI(page = 1, limit = 20) {
  const body = {
    operationName: 'Contents',
    query: GRAPHQL_QUERY,
    variables: {
      classification: 'clicrbs-rs/gauchazh/esportes',
      tag: 'estadao-conteudo',
      limit,
      page,
    },
  };
  const res = await axios.post(GRAPHQL_URL, body, { headers: HEADERS, timeout: 15000 });
  return res.data?.data?.contents || [];
}

function formatarData(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  return d.toLocaleString('pt-BR');
}

// HOME
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

// MATÉRIAS
app.get('/materias', async (req, res) => {
  try {
    const items = await buscarMateriasDaAPI(1, 20);

    const materias = items.map(item => ({
      titulo: item.headline?.text || '',
      link: item.links?.canonical || '',
      data: item.published_timestamp,
      tempo: formatarData(item.published_timestamp),
      foto: item.img?.src || '',
      autor: item.authors?.[0]?.name || '',
    }));

    res.json({ ok: true, total: materias.length, materias });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// MATÉRIA COMPLETA — parágrafos separados por \n\n, sem lixo
app.get('/materia', async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  // Tenta com diferentes User-Agents
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
  ];

  let response = null;
  let lastError = null;

  for (const ua of userAgents) {
    try {
      response = await axios.get(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Referer': 'https://www.google.com/',
        },
        timeout: 15000,
        maxRedirects: 5,
      });
      if (response.status === 200) break;
    } catch(e) {
      lastError = e;
      continue;
    }
  }

  if (!response) {
    return res.status(500).json({ ok: false, erro: lastError?.message || 'Não foi possível acessar a matéria' });
  }

  try {

    const $ = cheerio.load(response.data);

    // Título
    const titulo = $('h1').first().text().trim();

    // Remove elementos indesejados
    $('script, style, nav, header, footer, aside, figure, figcaption').remove();
    $('[class*="ad"], [class*="banner"], [class*="related"], [class*="recommend"]').remove();
    $('[class*="newsletter"], [class*="paywall"], [class*="subscription"]').remove();

    // Pega parágrafos do corpo da matéria
    // Tenta seletores específicos do GaúchaZH primeiro
    let paragrafos = [];

    const seletores = [
      'article p',
      '[class*="article"] p',
      '[class*="content"] p',
      '[class*="texto"] p',
      '[class*="body"] p',
      'main p',
      '.post p',
    ];

    for (const sel of seletores) {
      const encontrados = [];
      $(sel).each((i, el) => {
        const txt = $(el).text().trim();
        // Filtra parágrafos muito curtos ou que são lixo
        if (txt.length > 40 && !txt.includes('©') && !txt.includes('Todos os direitos')) {
          encontrados.push(txt);
        }
      });
      if (encontrados.length >= 3) {
        paragrafos = encontrados;
        break;
      }
    }

    // Fallback: todos os <p> com mais de 60 chars
    if (paragrafos.length < 2) {
      $('p').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 60 && !txt.includes('©') && !txt.includes('Todos os direitos')) {
          paragrafos.push(txt);
        }
      });
    }

    // Remove duplicatas
    paragrafos = [...new Set(paragrafos)];

    const texto = paragrafos.join('\n\n');

    res.json({ ok: true, titulo, texto });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// FOTOS GOOGLE (mantido, mas sem chave válida retorna erro esperado)
app.get('/fotos', async (req, res) => {
  const q = req.query.q || 'futebol brasil';
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
  const GOOGLE_CX = process.env.GOOGLE_CX || '';

  try {
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(q)}&searchType=image&key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}`;
    const r = await axios.get(url);
    const fotos = (r.data.items || []).map(i => ({ url: i.link }));
    res.json({ ok: true, fotos });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor da Duda rodando na porta ${PORT}`);
});
