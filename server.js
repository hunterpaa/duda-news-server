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

// Formata o texto da matéria com parágrafos organizados
function formatarTexto($) {
  const paragrafos = [];

  // Pega título h1
  const titulo = $('h1').first().text().trim();

  // Seletores do corpo da matéria
  const contentSels = [
    '[class*="article-body"]', '[class*="article-content"]',
    '[class*="post-content"]', '[class*="entry-content"]',
    '[class*="story-body"]', '[class*="news-content"]',
    '[class*="content-text"]', 'article', 'main',
  ];

  let container = null;
  for (const sel of contentSels) {
    const el = $(sel).first();
    if (el.length) { container = el; break; }
  }

  if (container) {
    // Remove lixo
    container.find('script,style,nav,aside,iframe,noscript,.ad,.ads,.share,.related,.comments,.newsletter,figure,button,.paywall').remove();

    // Percorre cada elemento filho mantendo estrutura
    container.find('p, h2, h3, h4, li').each((i, el) => {
      const tag = el.tagName?.toLowerCase();
      const texto = $(el).text().replace(/\s+/g, ' ').trim();
      if (!texto || texto.length < 3) return;

      if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
        paragrafos.push(`\n${texto.toUpperCase()}\n`);
      } else if (tag === 'li') {
        paragrafos.push(`• ${texto}`);
      } else {
        paragrafos.push(texto);
      }
    });
  }

  // Fallback: todos os <p>
  if (paragrafos.length === 0) {
    $('script,style,nav,header,footer,aside,iframe').remove();
    $('p').each((i, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length > 40) paragrafos.push(t);
    });
  }

  return paragrafos.join('\n\n');
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor da Duda rodando!' });
});

// Busca matérias do Estadão Conteúdo no GaúchaZH
app.get('/materias', async (req, res) => {
  try {
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

    materias.sort((a, b) => (b.data || 0) - (a.data || 0));

    res.json({ ok: true, total: materias.length, materias });
  } catch(e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Busca texto completo formatado de uma matéria
app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  try {
    const response = await axios.get(url, {
      headers: { ...HEADERS, 'Accept': 'text/html,application/xhtml+xml', 'Content-Type': undefined },
      timeout: 15000
    });
    const $ = cheerio.load(response.data);

    const titulo = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
    const foto = $('meta[property="og:image"]').attr('content') || $('article img').first().attr('src') || '';
    const texto = formatarTexto($);

    res.json({ ok: true, titulo, foto, texto });
  } catch(e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// Busca fotos para sugerir baseado no título da matéria
app.get('/fotos', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ ok: false, erro: 'Query não informada' });

  try {
    // Usa a API pública do Unsplash para buscar fotos de esporte
    // Fallback: usa Pexels API (gratuita)
    const query = encodeURIComponent(q + ' futebol esporte');
    
    // Tenta Unsplash (sem chave, acesso limitado)
    const unsplashUrl = `https://unsplash.com/napi/search/photos?query=${query}&per_page=6&orientation=landscape`;
    
    const r = await axios.get(unsplashUrl, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Accept': 'application/json',
        'Referer': 'https://unsplash.com/',
      },
      timeout: 10000
    });

    const fotos = (r.data?.results || []).slice(0, 6).map(f => ({
      url: f.urls?.regular || f.urls?.small || '',
      thumb: f.urls?.small || f.urls?.thumb || '',
      autor: f.user?.name || '',
      alt: f.alt_description || q,
    })).filter(f => f.url);

    res.json({ ok: true, fotos });
  } catch(e) {
    res.json({ ok: false, fotos: [], erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));
