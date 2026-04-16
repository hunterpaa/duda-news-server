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

// Cookie em memória
let phpSessionId = '';

// HOME
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

// SALVAR COOKIE
app.post('/cookie', (req, res) => {
  const { phpsessid } = req.body;
  if (!phpsessid) return res.status(400).json({ ok: false, erro: 'Cookie não informado' });
  phpSessionId = phpsessid;
  res.json({ ok: true, message: 'Cookie salvo!' });
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

// MATÉRIA COMPLETA
app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

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
          'Cache-Control': 'no-cache',
          'Referer': 'https://www.google.com/',
        },
        timeout: 15000,
        maxRedirects: 5,
      });
      if (response.status === 200) break;
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  if (!response) {
    return res.status(500).json({ ok: false, erro: lastError?.message || 'Não foi possível acessar a matéria' });
  }

  try {
    const $ = cheerio.load(response.data);
    const titulo = $('h1').first().text().trim();

    $('script, style, nav, header, footer, aside, figure, figcaption').remove();
    $('[class*="ad"], [class*="banner"], [class*="related"], [class*="recommend"]').remove();
    $('[class*="newsletter"], [class*="paywall"], [class*="subscription"]').remove();

    let paragrafos = [];
    const seletores = [
      'article p', '[class*="article"] p', '[class*="content"] p',
      '[class*="texto"] p', '[class*="body"] p', 'main p', '.post p',
    ];

    for (const sel of seletores) {
      const encontrados = [];
      $(sel).each((i, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 40 && !txt.includes('©') && !txt.includes('Todos os direitos')) {
          encontrados.push(txt);
        }
      });
      if (encontrados.length >= 3) { paragrafos = encontrados; break; }
    }

    if (paragrafos.length < 2) {
      $('p').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 60 && !txt.includes('©') && !txt.includes('Todos os direitos')) {
          paragrafos.push(txt);
        }
      });
    }

    paragrafos = [...new Set(paragrafos)];
    const texto = paragrafos.join('\n\n');
    res.json({ ok: true, titulo, texto });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// UPLOAD DE FOTO
app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo } = req.body;

  if (!fotoUrl || !titulo) {
    return res.status(400).json({ ok: false, erro: 'fotoUrl e titulo são obrigatórios' });
  }

  if (!phpSessionId) {
    return res.status(401).json({ ok: false, erro: 'Cookie de sessão não encontrado. Clique no favorito Tanaka Sports no NextSite primeiro!' });
  }

  try {
    // Baixa a imagem
    const imgResponse = await axios.get(fotoUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.google.com/',
      }
    });

    // Descobre o tipo da imagem
    const contentType = imgResponse.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';

    // Monta o nome do arquivo com o título da matéria
    const nomeArquivo = titulo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 80) + '.' + ext;

    // Monta o FormData
    const form = new FormData();
    form.append('files[]', Buffer.from(imgResponse.data), {
      filename: nomeArquivo,
      contentType: contentType,
    });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', nomeArquivo.replace('.' + ext, ''));
    form.append('credito_wda[0]', 'Estadão Conteúdo');
    form.append('descricao_wda[0]', titulo);
    form.append('keyword_wda[0]', '');
    form.append('transparencia_wda[0]', '0');
    form.append('publica[0]', '1');

    // Faz o upload no NextSite
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

    res.json({ ok: true, message: 'Foto enviada com sucesso!', nomeArquivo, resposta: uploadRes.data });

  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor da Duda rodando na porta ${PORT}`);
});
