const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Content-Type': 'application/json',
  'Origin': 'https://gauchazh.clicrbs.com.br',
  'Referer': 'https://gauchazh.clicrbs.com.br/esportes/ultimas-noticias/',
};

const GRAPHQL_URL = 'https://gauchazh.clicrbs.com.br/graphql?v=2';

const GRAPHQL_QUERY = `query Contents($classification: String!, $tag: String, $limit: Int, $page: Int, $filter: String, $dateFrom: String, $dateTo: String, $type: String) {
  contents(
    classification: $classification
    tag: $tag
    limit: $limit
    page: $page
    filter: $filter
    date_from: $dateFrom
    date_to: $dateTo
    type: $type
  ) {
    ... on ArticleContent {
      id
      type
      headline { text }
      support_line { text }
      published_timestamp
      authors { name }
      img { src alt }
      links { canonical path }
      tags { name slug }
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
      type: null,
    },
  };

  const res = await axios.post(GRAPHQL_URL, body, { headers: HEADERS, timeout: 15000 });
  return res.data?.data?.contents || [];
}

function formatarData(timestamp) {
  if (!timestamp) return '';
  try {
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + 'h';
  } catch(e) { return ''; }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor da Duda rodando!' });
});

// Busca matérias do Estadão Conteúdo no GaúchaZH
app.get('/materias', async (req, res) => {
  try {
    // Busca as últimas 20 matérias
    const items = await buscarMateriasDaAPI(1, 20);

    if (!items || items.length === 0) {
      return res.json({ ok: false, erro: 'Nenhuma matéria encontrada.' });
    }

    const materias = items.map(item => ({
      titulo: item.headline?.text || item.support_line?.text || '',
      link: item.links?.canonical || ('https://gauchazh.clicrbs.com.br' + (item.links?.path || '')),
      tempo: formatarData(item.published_timestamp),
      data: item.published_timestamp,
      foto: item.img?.src || '',
      autor: item.authors?.[0]?.name || '',
    })).filter(m => m.titulo && m.link);

    // Ordena mais recente primeiro
    materias.sort((a, b) => (b.data || 0) - (a.data || 0));

    res.json({ ok: true, total: materias.length, materias });
  } catch(e) {
    console.log('Erro:', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Busca texto completo de uma matéria
app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  try {
    const response = await axios.get(url, {
      headers: {
        ...HEADERS,
        'Accept': 'text/html,application/xhtml+xml',
        'Content-Type': undefined,
      },
      timeout: 15000
    });
    const $ = cheerio.load(response.data);

    const titulo =
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') || '';

    const foto =
      $('meta[property="og:image"]').attr('content') ||
      $('article img').first().attr('src') || '';

    $('script,style,nav,header,footer,aside,iframe,noscript,.ad,.ads,.share,.related,.comments,.newsletter,figure').remove();

    const contentSels = [
      '[class*="article-body"]', '[class*="article-content"]',
      '[class*="post-content"]', '[class*="entry-content"]',
      '[class*="story-body"]', '[class*="news-content"]',
      '[class*="content-text"]', '[class*="materia"]',
      'article', '.content', 'main',
    ];

    let texto = '';
    for (const sel of contentSels) {
      const el = $(sel).first();
      if (el.length) {
        const t = el.text().replace(/\s+/g, ' ').trim();
        if (t.length > 300) { texto = t; break; }
      }
    }

    if (!texto || texto.length < 300) {
      const ps = [];
      $('p').each((i, el) => {
        const t = $(el).text().trim();
        if (t.length > 40) ps.push(t);
      });
      const fallback = ps.join('\n\n');
      if (fallback.length > texto.length) texto = fallback;
    }

    res.json({ ok: true, titulo, foto, texto });
  } catch(e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));
