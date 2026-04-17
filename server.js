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

// ── EXTRAI palavras-chave relevantes do título ────────────────────────────────
// Remove stop words, mantém nomes próprios (times, atletas) e termos esportivos
function extrairPalavrasChave(titulo) {
  const stopWords = new Set([
    'de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem',
    'que','se','o','a','os','as','um','uma','uns','umas','ao','à','aos','às',
    'e','ou','mas','mais','como','seu','sua','seus','suas','este','esta','isso',
    'pelo','pela','pelos','pelas','após','ante','até','entre','sobre','sob',
    'foi','é','são','vai','vem','tem','ter','ser','estar','está',
    'novo','nova','novos','novas','boa','bom','grande','pequeno','primeiro','segunda',
    'já','ainda','também','agora','quando','onde','quem','qual',
  ]);

  const palavras = titulo
    .replace(/[^\wÀ-ÿ\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length > 2 && !stopWords.has(p.toLowerCase()));

  // Nomes próprios (maiúscula) têm prioridade — geralmente times e atletas
  const proprias = palavras.filter(p => /^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  const demais   = palavras.filter(p => !/^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));

  const selecionadas = [...new Set([...proprias, ...demais])].slice(0, 6);
  return selecionadas.join(' ');
}
// ─────────────────────────────────────────────────────────────────────────────

let phpSessionId = '';

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

app.post('/cookie', (req, res) => {
  const { phpsessid } = req.body;
  if (!phpsessid) return res.status(400).json({ ok: false, erro: 'Cookie não informado' });
  phpSessionId = phpsessid;
  res.json({ ok: true, message: 'Cookie salvo!' });
});

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

// ── BUSCAR FOTOS ──────────────────────────────────────────────────────────────
// ?titulo=...&pagina=1  (pagina 1,2,3... para o botão "Outras fotos")
app.get('/buscar-fotos', async (req, res) => {
  const { titulo, pagina = '1' } = req.query;
  if (!titulo) return res.status(400).json({ ok: false, erro: 'titulo é obrigatório' });

  const pg = Math.max(1, parseInt(pagina) || 1);
  const palavrasChave = extrairPalavrasChave(titulo);
  const bingFirst = (pg - 1) * 6 + 1;

  // Tentativa 1: Bing Images com paginação real via ?first=
  try {
    const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(palavrasChave)}&form=HDRSC2&first=${bingFirst}&count=6`;
    const response = await axios.get(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Referer': 'https://www.bing.com/',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const fotos = [];

    $('.iusc').each((i, el) => {
      if (fotos.length >= 6) return false;
      try {
        const m = $(el).attr('m');
        if (!m) return;
        const dados = JSON.parse(m);
        const url = dados.murl;
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          fotos.push(url);
        }
      } catch (e) { /* ignora */ }
    });

    if (fotos.length === 0) {
      $('img.mimg').each((i, el) => {
        if (fotos.length >= 6) return false;
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && src.startsWith('http') && !src.includes('bing.com')) {
          fotos.push(src);
        }
      });
    }

    if (fotos.length > 0) {
      return res.json({ ok: true, total: fotos.length, fotos, palavrasChave, pagina: pg, fonte: 'bing' });
    }
  } catch (e) {
    console.error('Bing falhou:', e.message);
  }

  // Tentativa 2: DuckDuckGo Images com offset de página
  try {
    const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(palavrasChave)}&iax=images&ia=images`;
    const tokenRes = await axios.get(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      timeout: 10000,
    });

    const vqdMatch = tokenRes.data.match(/vqd=([\d-]+)/);
    if (vqdMatch) {
      const vqd = vqdMatch[1];
      const ddgOffset = (pg - 1) * 6;
      const apiUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(palavrasChave)}&vqd=${vqd}&f=,,,,,&p=1&s=${ddgOffset}`;
      const imgRes = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://duckduckgo.com/',
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      const resultados = imgRes.data?.results || [];
      const fotos = resultados
        .slice(0, 6)
        .map(r => r.image)
        .filter(url => url && url.startsWith('http'));

      if (fotos.length > 0) {
        return res.json({ ok: true, total: fotos.length, fotos, palavrasChave, pagina: pg, fonte: 'duckduckgo' });
      }
    }
  } catch (e) {
    console.error('DuckDuckGo falhou:', e.message);
  }

  return res.status(500).json({ ok: false, erro: 'Não foi possível buscar fotos. Tente de novo.' });
});
// ─────────────────────────────────────────────────────────────────────────────

// ── UPLOAD DE FOTO ────────────────────────────────────────────────────────────
// Legenda/nome gerados automaticamente a partir das palavras-chave do título.
// Clean e curto — ex: "Flamengo Palmeiras Brasileirao"
// O NextSite ordena por data de upload: mesmo nome duplicado, o mais recente aparece primeiro.
app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo } = req.body;

  if (!fotoUrl || !titulo) {
    return res.status(400).json({ ok: false, erro: 'fotoUrl e titulo são obrigatórios' });
  }

  if (!phpSessionId) {
    return res.status(401).json({ ok: false, erro: 'Cookie de sessão não encontrado. Clique no favorito Tanaka Sports no NextSite primeiro!' });
  }

  // Legenda curta = palavras-chave relevantes do título (mesmo algoritmo do buscar-fotos)
  // Ex: "Flamengo Palmeiras Brasileirao" — aparece assim no jornal
  const legendaCurta = extrairPalavrasChave(titulo);

  // Nome do arquivo = slug da legenda curta — simples e limpo
  const nomeSlug = legendaCurta
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/-+$/, '');

  try {
    const imgResponse = await axios.get(fotoUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.google.com/' }
    });

    const contentType = imgResponse.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';
    const nomeArquivo = `${nomeSlug}.${ext}`;

    const form = new FormData();
    form.append('files[]', Buffer.from(imgResponse.data), { filename: nomeArquivo, contentType });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', legendaCurta);    // legenda curta — aparece no jornal
    form.append('credito_wda[0]', 'Estadão Conteúdo');
    form.append('descricao_wda[0]', titulo);        // título completo na descrição
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

    res.json({ ok: true, message: 'Foto enviada!', nomeArquivo, legendaCurta, resposta: uploadRes.data });

  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));
