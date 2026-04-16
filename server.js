const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// HEADERS
// =========================
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Accept': 'application/json, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

// =========================
// GRAPHQL GAÚCHAZH
// =========================
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

// =========================
// BUSCAR MATÉRIAS
// =========================
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

  const res = await axios.post(GRAPHQL_URL, body, { timeout: 15000 });
  return res.data?.data?.contents || [];
}

// =========================
// FORMATAR DATA
// =========================
function formatarData(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  return d.toLocaleString('pt-BR');
}

// =========================
// HOME
// =========================
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

// =========================
// MATÉRIAS
// =========================
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

    res.json({ ok: true, materias });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// =========================
// MATÉRIA COMPLETA
// =========================
app.get('/materia', async (req, res) => {
  const { url } = req.query;

  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const titulo = $('h1').first().text();
    const texto = $('p').text();

    res.json({ ok: true, titulo, texto });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// =========================
// FOTOS GOOGLE
// =========================
app.get('/fotos', async (req, res) => {
  const q = req.query.q || 'futebol brasil';

  const GOOGLE_API_KEY = 'SUA_KEY';
  const GOOGLE_CX = 'SEU_CX';

  try {
    const url = `https://www.googleapis.com/customsearch/v1?q=${q}&searchType=image&key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}`;

    const r = await axios.get(url);

    const fotos = (r.data.items || []).map(i => ({
      url: i.link
    }));

    res.json({ ok: true, fotos });
  } catch (e) {
    res.json({ ok: false, erro: e.message });
  }
});

// =========================
// BOT PUBLICAR (PLAYWRIGHT)
// =========================
app.post('/publicar', async (req, res) => {
  let browser;

  try {
    const { titulo, texto } = req.body;

    browser = await chromium.launch({
      headless: true
    });

    const page = await browser.newPage();

    // 👉 CMS já logado
    await page.goto("https://admin-dc4.nextsite.com.br/t53kx1_admin/conteudos/novo.php?empresa=1&parent=8");

    await page.waitForTimeout(3000);

    // =========================
    // TÍTULO
    // =========================
    const tituloInput = await page.$('input[name*="titulo"], input[name*="title"], input[type="text"]');

    if (tituloInput) {
      await tituloInput.fill(titulo);
    }

    // =========================
    // TEXTO
    // =========================
    const editor = await page.$('textarea, div[contenteditable="true"]');

    if (editor) {
      await editor.fill(texto);
    } else {
      await page.evaluate((texto) => {
        document.body.innerText = texto;
      }, texto);
    }

    // =========================
    // PUBLICAR
    // =========================
    const botoes = [
      'button:has-text("Publicar")',
      'button:has-text("Salvar")',
      'input[type="submit"]'
    ];

    for (const sel of botoes) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        break;
      }
    }

    await page.waitForTimeout(3000);

    await browser.close();

    res.json({ ok: true, message: "Publicado com sucesso" });

  } catch (err) {
    if (browser) await browser.close();

    res.status(500).json({ ok: false, erro: err.message });
  }
});

// =========================
// BOT TESTE
// =========================
app.get('/bot-teste', (req, res) => {
  res.json({ ok: true });
});

// =========================
// START SERVER (SEMPRE POR ÚLTIMO)
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor da Duda rodando na porta ${PORT}`);
});
