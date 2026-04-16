const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://www.google.com/',
};

const RSS_FEEDS = [
  'https://gauchazh.clicrbs.com.br/esportes/feed/atom/',
  'https://gauchazh.clicrbs.com.br/ultimas-noticias/tag/estadao-conteudo/feed/atom/',
  'https://gauchazh.clicrbs.com.br/feed/atom/',
];

const SPORT_KEYWORDS = [
  'futebol','gol','jogo','partida','campeonato','copa','atleta','esporte',
  'time','clube','rodada','liga','placar','vitória','derrota','empate',
  'grêmio','inter','corinthians','flamengo','palmeiras','são paulo','santos',
  'atletico','vasco','botafogo','cruzeiro','fluminense','libertadores',
  'brasileirão','brasileiro','nba','tênis','f1','fórmula','olimp',
  'basquete','vôlei','ciclismo','rugby','boxe','mma','ufc','corrida',
  'maratona','natação','neymar','messi','cristiano',
];

function isEsporte(texto) {
  const t = (texto || '').toLowerCase();
  return SPORT_KEYWORDS.some(k => t.includes(k));
}

function isHoje(dateStr) {
  if (!dateStr) return true;
  const hoje = new Date();
  const data = new Date(dateStr);
  return (
    data.getDate() === hoje.getDate() &&
    data.getMonth() === hoje.getMonth() &&
    data.getFullYear() === hoje.getFullYear()
  );
}

function formatarHora(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + 'h';
  } catch(e) { return ''; }
}

async function buscarRSS(url) {
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(res.data, { xmlMode: true });
    const items = [];

    $('entry').each((i, el) => {
      const titulo = $(el).find('title').first().text().trim();
      const link = $(el).find('link').attr('href') || $(el).find('link').text().trim();
      const data = $(el).find('published, updated').first().text().trim();
      const resumo = $(el).find('summary, content').first().text().trim();
      if (titulo && link) items.push({ titulo, link, data, resumo });
    });

    if (items.length === 0) {
      $('item').each((i, el) => {
        const titulo = $(el).find('title').first().text().trim();
        const link = $(el).find('link').first().text().trim() || $(el).find('link').attr('href');
        const data = $(el).find('pubDate').first().text().trim();
        const resumo = $(el).find('description').first().text().trim();
        if (titulo && link) items.push({ titulo, link, data, resumo });
      });
    }

    return items;
  } catch(e) {
    return [];
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor da Duda rodando!' });
});

app.get('/materias', async (req, res) => {
  try {
    let todasMaterias = [];

    for (const feed of RSS_FEEDS) {
      const items = await buscarRSS(feed);
      todasMaterias = todasMaterias.concat(items);
    }

    // Remove duplicatas
    const titulos = new Set();
    todasMaterias = todasMaterias.filter(m => {
      if (titulos.has(m.titulo)) return false;
      titulos.add(m.titulo);
      return true;
    });

    // Filtra esportes
    let esportes = todasMaterias.filter(m => isEsporte(m.titulo + ' ' + m.resumo));

    // Filtra hoje
    const hoje = esportes.filter(m => isHoje(m.data));
    const resultado = hoje.length > 0 ? hoje : esportes;

    const materias = resultado.map(m => ({
      titulo: m.titulo,
      link: m.link,
      tempo: formatarHora(m.data),
      data: m.data,
    }));

    materias.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

    if (materias.length === 0) {
      return res.json({ ok: false, erro: 'Nenhuma matéria de esporte encontrada hoje.' });
    }

    res.json({ ok: true, total: materias.length, materias });
  } catch(e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  try {
    const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(response.data);

    const titulo =
      $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') || '';

    const foto =
      $('meta[property="og:image"]').attr('content') ||
      $('article img').first().attr('src') ||
      $('figure img').first().attr('src') || '';

    $('script,style,nav,header,footer,aside,iframe,noscript,.ad,.ads,.share,.related,.comments,.newsletter,figure').remove();

    const contentSels = [
      '[class*="article-body"]','[class*="article-content"]',
      '[class*="post-content"]','[class*="entry-content"]',
      '[class*="story-body"]','[class*="news-content"]',
      '[class*="content-text"]','[class*="materia"]',
      'article','.content','main',
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
      if (ps.join('\n\n').length > texto.length) texto = ps.join('\n\n');
    }

    res.json({ ok: true, titulo, foto, texto });
  } catch(e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));
