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
};

const GRAPHQL_URL = 'https://gauchazh.clicrbs.com.br/graphql?v=2';

function extrairPalavrasChave(titulo) {
  const stopWords = new Set(['de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem','que','se','o','a','os','as','um','uma','uns','umas','ao','à','aos','às','e','ou','mas','mais','como']);
  return titulo.replace(/[^\wÀ-ÿ\s]/g, ' ').split(/\s+/).filter(p => p.length > 2 && !stopWords.has(p.toLowerCase())).slice(0, 5).join(' ');
}

let phpSessionId = '';

app.get('/', (req, res) => res.json({ ok: true, status: 'Tanaka Online!' }));

app.post('/cookie', (req, res) => {
  phpSessionId = req.body.phpsessid;
  res.json({ ok: !!phpSessionId });
});

app.get('/materias', async (req, res) => {
  try {
    const query = `query Contents($classification: String!, $tag: String, $limit: Int, $page: Int) {
      contents(classification: $classification, tag: $tag, limit: $limit, page: $page) {
        ... on ArticleContent {
          headline { text }
          published_timestamp
          img { src }
          links { canonical }
        }
      }
    }`;
    const body = { operationName: 'Contents', query, variables: { classification: 'clicrbs-rs/gauchazh/esportes', tag: 'estadao-conteudo', limit: 20, page: 1 } };
    const resApi = await axios.post(GRAPHQL_URL, body, { headers: HEADERS });
    const materias = (resApi.data?.data?.contents || []).map(item => ({
      titulo: item.headline?.text || '',
      link: item.links?.canonical || '',
      foto: item.img?.src || '',
      tempo: new Date(item.published_timestamp * 1000).toLocaleString('pt-BR')
    }));
    res.json({ ok: true, materias });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.get('/materia', async (req, res) => {
  const { url } = req.query;
  try {
    const response = await axios.get(url, { headers: HEADERS });
    const $ = cheerio.load(response.data);
    const titulo = $('h1').first().text().trim();
    let textos = [];
    $('p').each((i, el) => { if ($(el).text().length > 50) textos.push($(el).text().trim()); });
    res.json({ ok: true, titulo, texto: textos.join('\n\n') });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.get('/buscar-fotos', async (req, res) => {
  const { titulo } = req.query;
  if (!titulo) return res.status(400).json({ ok: false });
  const q = extrairPalavrasChave(titulo);
  try {
    const response = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(q)}&tbm=isch`, { headers: HEADERS });
    const matches = response.data.match(/"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi) || [];
    const fotos = [...new Set(matches)].map(u => u.replace(/"/g, '')).filter(u => !u.includes('gstatic') && u.length < 300).slice(0, 10);
    if (!fotos.length) return res.status(404).json({ ok: false, erro: 'Sem fotos' });
    res.json({ ok: true, fotos, palavrasChave: q });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo } = req.body;
  if (!phpSessionId) return res.status(401).json({ ok: false, erro: 'Sem Cookie' });
  try {
    const imgRes = await axios.get(fotoUrl, { responseType: 'arraybuffer' });
    const form = new FormData();
    // LINHA CORRIGIDA AQUI:
    const nome = extrairPalavrasChave(titulo).toLowerCase().replace(/\s+/g, '-');
    form.append('files[]', Buffer.from(imgRes.data), { filename: `${nome}.jpg`, contentType: 'image/jpeg' });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', titulo.substring(0, 50));
    form.append('publica[0]', '1');
    await axios.post('https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/jquery-upload/jqueryupload.php', form, {
      headers: { ...form.getHeaders(), 'Cookie': `PHPSESSID=${phpSessionId}` }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Tanaka Sports On!'));
