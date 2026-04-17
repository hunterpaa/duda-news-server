const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/app', (req, res) => {
  const htmlPath = path.join(__dirname, 'app-duda.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('ERRO: app-duda.html nao encontrado na pasta tanaka!');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace("const SERVER = 'https://duda-news-server.onrender.com'", "const SERVER = 'http://localhost:3000'");
  res.send(html);
});
app.get('/', (req, res) => res.redirect('/app'));

function sanitizar(s) { return s ? s.replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/–|—/g,'-').replace(/ /g,' ') : ''; }
function formatarData(ts) { return ts ? new Date(ts*1000).toLocaleString('pt-BR') : ''; }
function gerarLegenda(titulo) {
  const stop = new Set(['de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem','que','se','o','a','os','as','um','uma','ao','e','ou','mas','mais','foi','sao','vai','tem','ja','apos','divulga','afirma','vence','bate','perde']);
  const p = titulo.replace(/[^wÀ-ÿs]/g,' ').split(/s+/).filter(w => w.length>2 && !stop.has(w.toLowerCase()));
  return [...new Set(p.filter(w => /^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(w)))].slice(0,4).join(' ') || p.slice(0,4).join(' ');
}

let phpSessionId = '';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' };

app.get('/ping', (req, res) => res.json({ ok: true, message: 'Servidor LOCAL rodando!' }));

app.post('/cookie', (req, res) => {
  phpSessionId = req.body.phpsessid || '';
  res.json({ ok: !!phpSessionId, message: 'Cookie salvo!' });
});

app.get('/materias', async (req, res) => {
  try {
    const r = await axios.post('https://gauchazh.clicrbs.com.br/graphql?v=2', {
      operationName: 'Contents',
      query: `query Contents($classification: String!, $tag: String, $limit: Int, $page: Int) { contents(classification: $classification, tag: $tag, limit: $limit, page: $page) { ... on ArticleContent { headline { text } published_timestamp authors { name } links { canonical } } } }`,
      variables: { classification: 'clicrbs-rs/gauchazh/esportes', tag: 'estadao-conteudo', limit: 20, page: 1 }
    }, { headers: HEADERS, timeout: 15000 });
    const materias = (r.data?.data?.contents || []).map(i => ({ titulo: sanitizar(i.headline?.text||''), link: i.links?.canonical||'', tempo: formatarData(i.published_timestamp), autor: i.authors?.[0]?.name||'' }));
    res.json({ ok: true, total: materias.length, materias });
  } catch(e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL nao informada' });
  let response = null;
  for (const ua of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36','Googlebot/2.1 (+http://www.google.com/bot.html)']) {
    try { response = await axios.get(url, { headers: {'User-Agent':ua,'Referer':'https://www.google.com/'}, timeout:15000, maxRedirects:5 }); if(response.status===200) break; } catch(e) { continue; }
  }
  if (!response) return res.status(500).json({ ok: false, erro: 'Nao foi possivel acessar' });
  const $ = cheerio.load(response.data);
  $('script,style,nav,header,footer,aside,[class*="ad"],[class*="paywall"]').remove();
  let paragrafos = [];
  for (const sel of ['article p','main p','p']) {
    const enc = []; $(sel).each((i,el) => { const t=$(el).text().trim(); if(t.length>40&&!t.includes('©')) enc.push(t); });
    if(enc.length>=3){paragrafos=enc;break;}
  }
  res.json({ ok:true, titulo:sanitizar($('h1').first().text().trim()), texto:sanitizar([...new Set(paragrafos)].join('\n\n')) });
});

app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo } = req.body;
  if (!fotoUrl||!titulo) return res.status(400).json({ ok:false, erro:'fotoUrl e titulo sao obrigatorios' });
  if (!phpSessionId) return res.status(401).json({ ok:false, erro:'Cookie nao encontrado! Abra o NextSite com o favorito Tanaka Sports primeiro.' });
  const legenda = gerarLegenda(titulo);
  const slug = legenda.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-zA-Z0-9s]/g,'').replace(/s+/g,'-').toLowerCase();
  try {
    const img = await axios.get(fotoUrl, { responseType:'arraybuffer', timeout:15000, headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.google.com/'} });
    const ct = img.headers['content-type']||'image/jpeg';
    const ext = ct.includes('png')?'png':ct.includes('gif')?'gif':'jpg';
    const form = new FormData();
    form.append('files[]',Buffer.from(img.data),{filename:slug+'.'+ext,contentType:ct});
    form.append('parent_wda[0]','6'); form.append('empresa','1'); form.append('titulo_wda[0]',legenda);
    form.append('credito_wda[0]','Estadao Conteudo'); form.append('descricao_wda[0]',titulo);
    form.append('keyword_wda[0]',''); form.append('transparencia_wda[0]','0'); form.append('publica[0]','1');
    await axios.post('https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/jquery-upload/jqueryupload.php', form, {
      headers:{...form.getHeaders(),'Cookie':'PHPSESSID='+phpSessionId,'Referer':'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/novo.php?empresa=1&parent=6','Origin':'https://admin-dc4.nextsite.com.br'},
      timeout:30000
    });
    res.json({ ok:true, message:'Foto enviada!', legenda });
  } catch(e) { res.status(500).json({ ok:false, erro:e.message }); }
});

app.listen(3000, () => {
  console.log('');
  console.log('  ================================');
  console.log('  TANAKA SPORTS - SERVIDOR LOCAL');
  console.log('  ================================');
  console.log('  App: http://localhost:3000/app');
  console.log('  ================================');
  console.log('');
});
