const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.google.com/',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

const SOURCE_URL = 'https://gauchazh.clicrbs.com.br/ultimas-noticias/tag/estadao-conteudo/';

// Rota de saúde
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor da Duda rodando!' });
});

// Busca lista de matérias do GaúchaZH
app.get('/materias', async (req, res) => {
  try {
    const response = await axios.get(SOURCE_URL, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(response.data);
    const materias = [];

    // Tenta vários seletores comuns de lista de artigos
    const seletores = [
      'article', '.article-item', '.news-item', '.card',
      '[class*="article"]', '[class*="news"]', '[class*="card"]'
    ];

    for (const sel of seletores) {
      $(sel).each((i, el) => {
        if (materias.length >= 10) return false;
        const titulo = $(el).find('h1, h2, h3, h4').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        const img = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';
        const tempo = $(el).find('time, [class*="time"], [class*="date"]').first().text().trim();

        if (titulo && titulo.length > 15 && link) {
          const href = link.startsWith('http') ? link : 'https://gauchazh.clicrbs.com.br' + link;
          // Filtra duplicatas
          if (!materias.find(m => m.titulo === titulo)) {
            materias.push({ titulo, link: href, img, tempo });
          }
        }
      });
      if (materias.length > 0) break;
    }

    // Fallback: pega todos os links com texto longo
    if (materias.length === 0) {
      $('a').each((i, el) => {
        if (materias.length >= 10) return false;
        const titulo = $(el).text().trim();
        const link = $(el).attr('href');
        if (titulo.length > 30 && link && link.includes('gauchazh')) {
          materias.push({ titulo, link, img: '', tempo: '' });
        }
      });
    }

    res.json({ ok: true, materias });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// Busca texto completo de uma matéria por URL
app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  try {
    const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(response.data);

    // Título
    const titulo = $('h1').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') || '';

    // Foto
    const foto = $('meta[property="og:image"]').attr('content') ||
      $('article img').first().attr('src') ||
      $('figure img').first().attr('src') || '';

    // Texto — remove elementos inúteis e pega o conteúdo principal
    const removeSels = ['script', 'style', 'nav', 'header', 'footer', 'aside',
      '.ad', '.ads', '.advertisement', '.related', '.share', '.social',
      '.comments', '.newsletter', 'iframe', 'noscript', 'figure'];

    const contentSels = [
      '[class*="article-body"]', '[class*="article-content"]',
      '[class*="post-content"]', '[class*="entry-content"]',
      '[class*="story-body"]', '[class*="news-content"]',
      'article', '.content', 'main'
    ];

    let texto = '';
    for (const sel of contentSels) {
      const el = $(sel).first();
      if (el.length) {
        removeSels.forEach(r => el.find(r).remove());
        const t = el.text().replace(/\s+/g, ' ').trim();
        if (t.length > 300) { texto = t; break; }
      }
    }

    // Fallback: todos os parágrafos
    if (!texto || texto.length < 300) {
      const paragrafos = [];
      $('p').each((i, el) => {
        const t = $(el).text().trim();
        if (t.length > 40) paragrafos.push(t);
      });
      texto = paragrafos.join('\n\n');
    }

    res.json({ ok: true, titulo, foto, texto });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
