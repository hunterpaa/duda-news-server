const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json());
const path2 = require('path');
app.get('/', (req, res) => {
  res.sendFile(path2.join(__dirname, 'app-duda.html'));
});
app.get('/app', (req, res) => {
  res.redirect('/');
});

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const GRAPHQL_URL = 'https://gauchazh.clicrbs.com.br/graphql?v=2';

// ── Sanitiza aspas especiais e caracteres problemáticos ──
function sanitizar(str) {
  if (!str) return '';
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00A0/g, ' ');
}

function formatarData(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('pt-BR');
}

// ── Converte qualquer texto em slug limpo para nome de arquivo ──
function toSlug(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[^a-zA-Z0-9\s-]/g, '')                     // remove especiais
    .replace(/\s+/g, '-')                                 // espaços → hífens
    .replace(/-+/g, '-')                                  // hífens duplos
    .replace(/^-|-$/g, '')                                // hífens nas pontas
    .toLowerCase()
    .substring(0, 60);                                    // limita tamanho
}

// ── Extrai palavras-chave (times, jogadores) — prioriza nomes próprios ──
function extrairPalavrasChave(titulo) {
  const stop = new Set([
    'de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem',
    'que','se','o','a','os','as','um','uma','ao','e','ou','mas','mais','como',
    'foi','é','são','vai','tem','já','após','até','sobre','pelo','pela',
    'novo','nova','boa','bom','grande','quando','onde','quem',
  ]);
  const palavras = titulo.replace(/[^\wÀ-ÿ\s]/g, ' ').split(/\s+/)
    .filter(p => p.length > 2 && !stop.has(p.toLowerCase()));
  const proprias = palavras.filter(p => /^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  const demais = palavras.filter(p => !/^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  return [...new Set([...proprias, ...demais])].slice(0, 5).join(' ');
}

// ── Gera legenda curta para o campo titulo_wda no NextSite ──
function gerarLegenda(titulo) {
  const stop = new Set([
    'de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem',
    'que','se','o','a','os','as','um','uma','ao','e','ou','mas','mais','como',
    'foi','é','são','vai','tem','já','após','até','sobre','pelo','pela',
    'divulga','afirma','anuncia','confirma','declara','revela','diz','fala',
    'vence','venceu','bate','perde','empata','marca','sofre','leva','ganha',
    'joga','jogou','estreia','retorna','volta','sai','entra','assina',
  ]);
  const palavras = titulo.replace(/[^\wÀ-ÿ\s]/g, ' ').split(/\s+/)
    .filter(p => p.length > 2 && !stop.has(p.toLowerCase()));
  const proprias = palavras.filter(p => /^[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(p));
  return [...new Set(proprias)].slice(0, 4).join(' ') || extrairPalavrasChave(titulo);
}

// ── Remove formatação markdown das legendas geradas por IA ──
function limparLegenda(txt) {
  return (txt || '')
    .replace(/^#+\s*/g, '')            // remove # ## ###
    .replace(/^legenda\s*[:：]\s*/i, '') // remove "Legenda:"
    .replace(/\*+/g, '')               // remove **negrito**
    .replace(/[.!?]$/, '')             // remove pontuação no final
    .trim();
}

// ── Traduz erros técnicos para português ──
function traduzirErro(e) {
  if (e.code === 'ECONNRESET')                          return 'Conexão interrompida. Tente de novo.';
  if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') return 'O servidor demorou para responder. Tente de novo.';
  if (e.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /tls|socket disconnected/i.test(e.message)) return 'Erro de conexão segura. Tente de novo.';
  if (e.response?.status === 404)                       return 'Matéria não encontrada.';
  if (e.response?.status === 403)                       return 'Acesso negado pelo site.';
  if (e.response?.status === 500)                       return 'Erro interno. Tente de novo em instantes.';
  if (e.response?.status)                               return `Erro ${e.response.status} do servidor.`;
  return 'Erro inesperado. Tente de novo.';
}

// ── Retry automático para erros de conexão ──
async function comRetry(fn, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      const retentar = e.code === 'ECONNRESET' || e.code === 'ECONNABORTED';
      if (!retentar || i === tentativas - 1) throw e;
      console.log(`[RETRY] Tentativa ${i + 2}/${tentativas} após ${e.code}...`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Cada IP tem seu próprio cookie de sessão — evita conflito entre usuários
const sessoes = new Map();

// ── STATUS ──
app.get('/status', (req, res) => {
  res.json({ ok: true, message: 'Servidor da Duda rodando!' });
});

// ── COOKIE ──
app.post('/cookie', (req, res) => {
  const { phpsessid } = req.body;
  if (!phpsessid) return res.status(400).json({ ok: false, erro: 'Cookie não informado' });
  const ip = req.ip || req.socket.remoteAddress;
  sessoes.set(ip, phpsessid);
  res.json({ ok: true, message: 'Cookie salvo!' });
});

// ── MATÉRIAS ──
app.get('/materias', async (req, res) => {
  try {
    const body = {
      operationName: 'Contents',
      query: `query Contents($classification: String!, $tag: String, $limit: Int, $page: Int) {
        contents(classification: $classification, tag: $tag, limit: $limit, page: $page) {
          ... on ArticleContent {
            headline { text }
            published_timestamp
            authors { name }
            img { src }
            links { canonical }
          }
        }
      }`,
      variables: {
        classification: 'clicrbs-rs/gauchazh/esportes',
        tag: 'estadao-conteudo',
        limit: 20,
        page: 1,
      },
    };
    console.log('[MATÉRIAS] Buscando artigos...');
    const r = await comRetry(() => axios.post(GRAPHQL_URL, body, { headers: HEADERS, timeout: 25000 }));
    const materias = (r.data?.data?.contents || []).map(item => ({
      titulo: sanitizar(item.headline?.text || ''),
      link: item.links?.canonical || '',
      tempo: formatarData(item.published_timestamp),
      autor: item.authors?.[0]?.name || '',
    }));
    console.log(`[MATÉRIAS] ${materias.length} artigos retornados`);
    res.json({ ok: true, total: materias.length, materias });
  } catch (e) {
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

const cacheMaterias = new Map();
const CACHE_TTL = 10 * 60 * 1000;

// ── MATÉRIA COMPLETA ──
app.get('/materia', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, erro: 'URL não informada' });

  const cached = cacheMaterias.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[MATÉRIA] Cache: ${url}`);
    return res.json(cached.data);
  }

  console.log(`[MATÉRIA] Scraping: ${url}`);

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
  ];

  let response = null;
  try {
    response = await comRetry(() => Promise.any(userAgents.map(ua =>
      axios.get(url, {
        headers: { 'User-Agent': ua, 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': 'https://www.google.com/' },
        timeout: 25000,
        maxRedirects: 5,
      })
    )));
  } catch (e) {
    return res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }

  try {
    const $ = cheerio.load(response.data);
    const titulo = $('h1').first().text().trim();

    $('script,style,nav,header,footer,aside,figure,figcaption').remove();
    $('[class*="ad"],[class*="banner"],[class*="related"],[class*="newsletter"],[class*="paywall"]').remove();
    let paragrafos = [];
    for (const sel of ['article p','[class*="article"] p','[class*="content"] p','main p','p']) {
      const encontrados = [];
      $(sel).each((i, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 40 && !txt.includes('©') && !txt.includes('Todos os direitos')) encontrados.push(txt);
      });
      if (encontrados.length >= 3) { paragrafos = encontrados; break; }
    }
    const texto = [...new Set(paragrafos)].join('\n\n');

    let autor = '';
    try {
      const isoMatch = response.data.match(/ISOMORPHIC_DATA__="([^"]{100,})"/);
      if (isoMatch) {
        const decoded = decodeURIComponent(isoMatch[1]);
        const compMatch = decoded.match(/"authors_complement":"(\{[^}]*\})"/);
        if (compMatch) {
          const obj = JSON.parse(compMatch[1].replace(/\\"/g, '"'));
          const nomes = Object.values(obj).filter(v => typeof v === 'string' && v.length > 1);
          if (nomes.length) autor = nomes[0];
        }
      }
    } catch {}

    const result = { ok: true, titulo: sanitizar(titulo), texto: sanitizar(texto), autor: sanitizar(autor) };
    cacheMaterias.set(url, { ts: Date.now(), data: result });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── UPLOAD DE FOTO ──
// Recebe fotoUrl, titulo, nomeFoto e apiKey (opcional, para Claude Vision)
app.post('/upload-foto', async (req, res) => {
  const { fotoUrl, titulo, nomeFoto, apiKey } = req.body;

  if (!fotoUrl || !titulo) {
    return res.status(400).json({ ok: false, erro: 'fotoUrl e titulo são obrigatórios' });
  }
  const ip = req.ip || req.socket.remoteAddress;
  const phpSessionId = sessoes.get(ip);
  if (!phpSessionId) {
    return res.status(401).json({ ok: false, erro: 'Cookie não encontrado. Abra o NextSite com o favorito Tanaka Sports primeiro!' });
  }

  // Nome do arquivo: usa nomeFoto enviado pelo app (já é slug), ou gera a partir do título
  const nomeSlug = nomeFoto ? toSlug(nomeFoto) : toSlug(gerarLegenda(titulo));

  // Legenda que aparece no NextSite — usa nomeFoto com espaços, ou gera a partir do título
  const legendaExibicao = nomeFoto
    ? nomeFoto.replace(/-/g, ' ')
    : gerarLegenda(titulo);

  try {
    // 1. Faz o download da imagem no servidor (evita bloqueio de CORS no celular)
    const imgRes = await comRetry(() => axios.get(fotoUrl, {
      responseType: 'arraybuffer',
      timeout: 35000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.google.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Connection': 'keep-alive',
      },
    }));

    // 2. Determina extensão pelo Content-Type
    const ct = imgRes.headers['content-type'] || 'image/jpeg';
    let ext = 'jpg';
    if (ct.includes('png')) ext = 'png';
    else if (ct.includes('gif')) ext = 'gif';
    else if (ct.includes('webp')) ext = 'webp';

    const nomeArquivo = `${nomeSlug}.${ext}`;

    // 2.5. Gera legenda com Claude Vision + texto em paralelo
    let legendaFinal = legendaExibicao;
    if (!apiKey) console.log('[LEGENDA] apiKey não recebida — usando fallback');
    if (apiKey) {
      try {
        const imgBytes = imgRes.data.byteLength || imgRes.data.length || 0;
        const imgKB = Math.round(imgBytes / 1024);
        const mimeBase = ct.split(';')[0].trim().toLowerCase();
        const mediaType = ['image/png','image/webp','image/gif'].includes(mimeBase) ? mimeBase : 'image/jpeg';
        const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };

        // Vision só roda se a imagem for <= 1.5MB (base64 ficaria ~2MB)
        const LIMITE_VISION_KB = 1500;
        const usarVision = imgKB <= LIMITE_VISION_KB;
        console.log(`[LEGENDA] Imagem: ${imgKB}KB (${mediaType}) — Vision: ${usarVision ? 'sim' : 'NÃO (muito grande)'}`);

        const chamarTexto = () => axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 40,
          messages: [{ role: 'user', content: `Com base neste título de matéria esportiva, crie uma legenda curta de até 8 palavras em português para a foto. Sem pontuação no final.\n\nTítulo: "${titulo}"` }],
        }, { headers, timeout: 9000 });

        let promessaVision;
        if (usarVision) {
          const base64Img = Buffer.from(imgRes.data).toString('base64');
          promessaVision = axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 40,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Img } },
              { type: 'text', text: `Matéria: "${titulo}"\n\nDescreva esta foto esportiva em até 8 palavras em português. Use o contexto da matéria para identificar times e jogadores. Sem pontuação no final. Exemplo: Jogadores do Flamengo comemoram vitória` }
            ]}],
          }, { headers, timeout: 15000 });
        } else {
          promessaVision = Promise.reject(new Error('Imagem muito grande — Vision pulado'));
        }

        const [resVision, resTexto] = await Promise.allSettled([promessaVision, chamarTexto()]);

        const legVision = resVision.status === 'fulfilled' ? limparLegenda(resVision.value.data.content[0].text) : null;
        const legTexto  = resTexto.status  === 'fulfilled' ? limparLegenda(resTexto.value.data.content[0].text)  : null;

        if (legVision) console.log(`[LEGENDA] 📷 Vision OK: "${legVision}"`);
        else {
          let err = resVision.reason?.message || 'erro desconhecido';
          if (resVision.reason?.response?.data) {
            try { const d = resVision.reason.response.data; err = typeof d === 'object' ? JSON.stringify(d).substring(0, 300) : String(d).substring(0, 300); } catch {}
          }
          console.warn(`[LEGENDA] 📷 Vision falhou: ${err}`);
        }
        if (legTexto) console.log(`[LEGENDA] 📝 Texto OK: "${legTexto}"`);
        else console.warn(`[LEGENDA] 📝 Texto falhou: ${resTexto.reason?.message}`);

        if (legVision && legTexto) {
          // Ambos funcionaram — combina as duas informações numa 3ª chamada rápida
          try {
            const resCombinar = await axios.post('https://api.anthropic.com/v1/messages', {
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 40,
              messages: [{ role: 'user', content:
                `Você tem duas descrições de uma foto esportiva e o título da matéria. Combine as informações para criar UMA legenda única de até 8 palavras em português. Use nomes próprios e contexto do título quando souber. Sem pontuação no final.\n\nTítulo: "${titulo}"\nO que aparece na foto: "${legVision}"\nContexto da matéria: "${legTexto}"\n\nLegenda:`
              }],
            }, { headers, timeout: 8000 });
            const legCombinada = limparLegenda(resCombinar.data.content[0].text);
            if (legCombinada) {
              console.log(`[LEGENDA] 🔀 Combinada: "${legCombinada}"`);
              legendaFinal = legCombinada;
            } else {
              legendaFinal = legVision;
            }
          } catch(eComb) {
            console.warn(`[LEGENDA] 🔀 Combinar falhou: ${eComb.message} — usando Vision`);
            legendaFinal = legVision;
          }
        } else if (legVision) {
          legendaFinal = legVision;
        } else if (legTexto) {
          legendaFinal = legTexto;
        }

        if (legendaFinal !== legendaExibicao) {
          console.log(`[LEGENDA] ✅ Usando: "${legendaFinal}"`);
        } else {
          console.warn('[LEGENDA] ⚠️ Todos falharam — usando nome abreviado');
        }
      } catch(e) {
        console.warn('[LEGENDA] Erro inesperado:', e.message);
      }
    }

    // 3. Monta o FormData e envia ao NextSite
    const form = new FormData();
    form.append('files[]', Buffer.from(imgRes.data), {
      filename: nomeArquivo,
      contentType: ct,
    });
    form.append('parent_wda[0]', '6');
    form.append('empresa', '1');
    form.append('titulo_wda[0]', legendaFinal);
    form.append('credito_wda[0]', '');
    form.append('descricao_wda[0]', legendaFinal);
    form.append('keyword_wda[0]', '');
    form.append('transparencia_wda[0]', '0');
    form.append('publica[0]', '1');

    let uploadRes;
    try {
      uploadRes = await comRetry(() => axios.post(
        'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/jquery-upload/jqueryupload.php',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Cookie': `PHPSESSID=${phpSessionId}`,
            'Referer': 'https://admin-dc4.nextsite.com.br/t53kx1_admin/webdisco/novo.php?empresa=1&parent=6',
            'Origin': 'https://admin-dc4.nextsite.com.br',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Connection': 'keep-alive',
          },
          timeout: 35000,
        }
      ));
    } catch (uploadErr) {
      const status = uploadErr.response?.status;
      console.error(`[UPLOAD] Erro no NextSite: ${uploadErr.message}`);
      if (status === 403 || status === 401) {
        return res.status(401).json({ ok: false, erro: 'Cookie expirado. Renove o cookie e tente de novo.' });
      }
      throw uploadErr;
    }

    // Loga a resposta do NextSite para debug
    console.log(`[UPLOAD] Foto enviada: ${nomeArquivo} → status ${uploadRes.status}`);

    res.json({ ok: true, message: 'Foto enviada!', nomeArquivo, legendaExibicao, legendaFinal });

  } catch (e) {
    console.error(`[UPLOAD] Erro: ${e.message}`);
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── SELEÇÃO AUTOMÁTICA DE FOTO ──
// Recebe candidatas do Google Imagens, Claude escolhe a melhor pelo índice e gera legenda inicial
app.post('/escolher-foto', async (req, res) => {
  const { urls, titulo, apiKey } = req.body;
  if (!urls?.length || !titulo || !apiKey) {
    return res.status(400).json({ ok: false, erro: 'urls, titulo e apiKey obrigatórios' });
  }

  // Pré-filtro sem download — elimina logos e formatos inúteis pela URL
  const filtradas = urls.filter(url => {
    if (!/^https?:\/\//i.test(url)) return false;
    if (/logo|escudo|crest|badge|icon|avatar|spinner|placeholder/i.test(url)) return false;
    if (/\.(gif|svg|ico)(\?|$)/i.test(url)) return false;
    return true;
  }).slice(0, 4);

  if (filtradas.length === 0) {
    return res.status(422).json({ ok: false, erro: 'Nenhuma URL passou no filtro' });
  }

  console.log(`[FOTO] 🔍 Analisando ${filtradas.length} candidatas para: "${titulo.substring(0, 50)}"`);

  try {
    // Baixa as candidatas em paralelo para converter em base64
    // (URLs do Google bloqueiam acesso direto pela Anthropic)
    const downloads = await Promise.allSettled(filtradas.map(url =>
      axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 6000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.google.com/',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
      })
    ));

    // Monta lista apenas com os downloads que funcionaram
    const imagensOk = downloads
      .map((r, i) => ({ resultado: r, url: filtradas[i] }))
      .filter(x => x.resultado.status === 'fulfilled')
      .map(x => {
        const ct = (x.resultado.value.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
        const mediaType = ['image/png', 'image/webp', 'image/gif'].includes(ct) ? ct : 'image/jpeg';
        const base64 = Buffer.from(x.resultado.value.data).toString('base64');
        return { url: x.url, mediaType, base64 };
      });

    if (imagensOk.length === 0) {
      return res.status(422).json({ ok: false, erro: 'Não foi possível baixar nenhuma imagem candidata' });
    }

    console.log(`[FOTO] 📥 ${imagensOk.length}/${filtradas.length} imagens baixadas com sucesso`);

    // Monta prompt com base64
    const conteudo = [
      ...imagensOk.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
      { type: 'text', text: `Matéria esportiva: "${titulo}"\n\nVocê recebeu ${imagensOk.length} foto(s) acima (índices 0 a ${imagensOk.length - 1}).\nEscolha a MELHOR foto para ilustrar esta matéria. Responda SOMENTE com JSON válido, sem texto extra:\n{"index": 0, "legenda": "descrição em até 8 palavras"}` },
    ];

    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{ role: 'user', content: conteudo }],
    }, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 8000,
    });

    const texto = r.data.content[0].text.trim();
    // Extrai JSON mesmo que Claude adicione texto ao redor
    const match = texto.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error(`Resposta não é JSON: ${texto.substring(0, 100)}`);

    const parsed = JSON.parse(match[0]);
    const idx = parsed.index;

    if (typeof idx !== 'number' || idx < 0 || idx >= imagensOk.length) {
      throw new Error(`Índice inválido: ${idx} (temos ${imagensOk.length} imagens)`);
    }

    const urlEscolhida = imagensOk[idx].url;
    const legenda = limparLegenda(parsed.legenda || '');
    console.log(`[FOTO] ✅ Escolheu índice ${idx} | legenda: "${legenda}"`);

    // candidatas: URL escolhida primeiro, depois as demais para fallback de download
    const candidatas = [
      urlEscolhida,
      ...imagensOk.filter((_, i) => i !== idx).map(x => x.url),
      ...filtradas.filter(u => !imagensOk.some(x => x.url === u)),
    ];

    res.json({ ok: true, index: 0, url: urlEscolhida, legenda, candidatas });

  } catch (e) {
    const err = e.response?.data ? JSON.stringify(e.response.data).substring(0, 200) : e.message;
    console.warn(`[FOTO] ❌ Seleção automática falhou: ${err}`);
    res.status(500).json({ ok: false, erro: err });
  }
});

// ── CLASSIFICAR CHAPÉU (proxy para API Anthropic — evita CORS do browser) ──
app.post('/classificar-chapeu', async (req, res) => {
  const { titulo, texto, apiKey } = req.body;
  if (!titulo || !apiKey) return res.status(400).json({ ok: false, erro: 'titulo e apiKey são obrigatórios' });
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: 'Você é um classificador de matérias esportivas para um jornal brasileiro. Responda APENAS com uma opção desta lista exata, sem inventar palavras novas. Escolha a mais específica possível:\n\nFUTEBOL, FUTSAL, FUTEBOL AMERICANO, BASQUETE, VÔLEI, VÔLEI DE PRAIA, TÊNIS, TÊNIS DE MESA, BADMINTON, SQUASH, PADEL, BEACH TENNIS, FÓRMULA 1, AUTOMOBILISMO, RALI, MOTOCICLISMO, MOTO GP, NATAÇÃO, NATAÇÃO ARTÍSTICA, MERGULHO, POLO AQUÁTICO, SURFE, REMO, CANOAGEM, VELA, ATLETISMO, MARATONA, CORRIDA DE RUA, CICLISMO, MOUNTAIN BIKE, BMX, GINÁSTICA ARTÍSTICA, GINÁSTICA RÍTMICA, GINÁSTICA ACROBÁTICA, TRAMPOLIM, SKATE, SNOWBOARD, SKI, PATINAÇÃO, HÓQUEI NO GELO, HÓQUEI NA GRAMA, RUGBY, HANDEBOL, BEISEBOL, SOFTBOL, CRÍQUETE, GOLFE, HIPISMO, PENTATLO MODERNO, TRIATLO, IRONMAN, MMA, UFC, BOXE, KICKBOXING, MUAY THAI, JUDÔ, KARATÊ, TAEKWONDO, WRESTLING, LUTA OLÍMPICA, ESGRIMA, TIRO ESPORTIVO, TIRO COM ARCO, LEVANTAMENTO DE PESO, HALTEROFILISMO, CROSSFIT, ESCALADA, PARAOLIMPÍADAS, ESPORTS.\n\nSe o esporte não estiver na lista escolha o mais próximo. NUNCA invente palavras. Responda SOMENTE com uma opção da lista, sem explicação, sem pontuação extra.',
      messages: [{ role: 'user', content: `Título: ${titulo}\nTexto: ${(texto || '').substring(0, 500)}` }],
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 10000,
    });
    const chapeu = r.data.content[0].text.trim();
    console.log(`[CHAPÉU] ${chapeu} ← "${titulo.substring(0, 50)}"`);
    res.json({ ok: true, chapeu });
  } catch(e) {
    console.error('[CHAPÉU] Erro:', e.message);
    res.status(500).json({ ok: false, erro: traduzirErro(e) });
  }
});

// ── GOOGLE IMAGENS (relay Tampermonkey → app) ──
let googleImagensCache = [];
app.post('/google-imagens', (req, res) => {
  googleImagensCache = req.body.urls || [];
  res.json({ ok: true });
});
app.get('/google-imagens', (req, res) => {
  const urls = googleImagensCache;
  googleImagensCache = [];
  res.json({ urls });
});

// ── FOTO ENVIADA (relay app → Tampermonkey para fechar aba Google) ──
let fotoEnviadaFlag = false;
app.post('/foto-enviada', (req, res) => {
  fotoEnviadaFlag = true;
  res.json({ ok: true });
});
app.get('/foto-enviada', (req, res) => {
  const foi = fotoEnviadaFlag;
  fotoEnviadaFlag = false;
  res.json({ foi });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`Servidor da Duda rodando na porta ${PORT}`));
