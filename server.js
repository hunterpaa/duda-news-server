const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

function sanitizar(str) {
  if (!str) return '';
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00A0/g, ' ');
}

function formatarData(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  return d.toLocaleString('pt-BR');
}

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

  const proprias = palavras.filter(p => /^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  const demais   = palavras.filter(p => !/^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));

  const selecionadas = [...new Set([...proprias, ...demais])].slice(0, 5);
  return selecionadas.join(' ');
}

let phpSessionId = '';

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Servidor Tanaka Sports - Modo Ninja Ativo!' });
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
      titulo: sanitizar(item.headline?.text || ''),
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

  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.google.com/' },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);
    const titulo = $('h1').first().text().trim();
    $('script, style, nav, header, footer, aside, figure, figcaption').remove();
    
    let paragrafos = [];
    $('p').each((i, el) => {
      const txt = $(el).text().trim();
      if (txt.length > 50 && !txt.includes('©')) paragrafos.push(txt);
    });

    res.json({ ok: true, titulo: sanitizar(titulo), texto: sanitizar(paragrafos.join('\n\n')) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// 🚀 BUSCA NINJA V3 (SEM API / SEM CUSTO)
app.get('/buscar-fotos', async (req, res) => {
  const { titulo } = req.query;
  if (!titulo) return res.status(400).json({ ok: false, erro: 'titulo é obrigatório' });

  const q = extrairPalavrasChave(titulo);
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch&hl=pt-BR`;

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.google.com/',
      },
      timeout: 10000,
    });

    const html = response.data;
    // Regex aprimorada para achar URLs reais de imagens no meio do código do Google
    const regex = /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi;
    let matches = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      matches.push(match[1]);
    }

    const fotos = [...new Set(matches)]
      .filter(u => 
        !u.includes('gstatic.com') && 
        !u.includes('encrypted-tbn') && 
        u.length < 300
      )
      .slice(0, 10);

    if (fotos.length === 0) {
      return res.status(404).json({ ok: false, erro: 'Nenhuma foto encontrada. Tente um título diferente.' });
    }

    return res.json({ ok: true, fotos, palavrasChave: q, fonte: 'google-scraping-v3' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: 'Erro na busca: ' + e.message });
  }
});

app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo } = req.body;
  if (!fotoUrl || !titulo || !phpSessionId) return res.status(400).json({ ok: false, erro: 'Faltam dados ou sessão' });

  const legendaCurta = extrairPalavrasChave(titulo);
  const nomeSlug = legendaCurta.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').toLowerCase();

  try {
    const imgRes = await axios.get(fotoUrl, { responseType: 'arraybuffer', timeout: 15000 });
    const form = new FormData();
    form.append('files[]', Buffer.from(imgRes.data), { filename: `${nomeSlug}.jpg`, contentType: 'image/jpeg' });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', legendaCurta);
    form.append('credito_wda[0]', 'Estadão Conteúdo');
    form.append('descricao_wda[0]', titulo);
    form.append('publica[0]', '1');

    const uploadRes = await axios.post(
      'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/jquery-upload/jqueryupload.php',
      form,
      { headers: { ...form.getHeaders(), 'Cookie': `PHPSESSID=${phpSessionId}` }, timeout: 30000 }
    );
    res.json({ ok: true, message: 'Foto enviada!', resposta: uploadRes.data });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
