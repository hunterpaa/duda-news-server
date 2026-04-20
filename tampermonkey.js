// ==UserScript==
// @name         Tanaka → NextSite (auto-preencher)
// @namespace    http://tampermonkey.net/
// @version      4.2
// @description  Preenche o formulário do NextSite automaticamente com os dados do app da Duda
// @author       Duda & Claude
// @match        https://admin-dc4.nextsite.com.br/t53kx1_admin/*
// @match        https://www.google.com/search*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Fluxo: renovar cookie (tanaka_cookie=1) — salva no sessionStorage antes de qualquer redirect
  if (new URLSearchParams(window.location.search).get('tanaka_cookie') === '1') {
    sessionStorage.setItem('tanaka_cookie_pending', '1');
  }
  if (sessionStorage.getItem('tanaka_cookie_pending') === '1') {
    sessionStorage.removeItem('tanaka_cookie_pending');
    const match = document.cookie.match(/PHPSESSID=([^;]+)/);
    if (match) {
      const ps = JSON.stringify({ phpsessid: match[1] });
      fetch('https://duda-news-server.onrender.com/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ps });
      fetch('http://localhost:3000/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ps }).catch(() => {});
    }
    const d = document.createElement('div');
    d.innerHTML = '✅ Cookie renovado!';
    d.style.cssText = 'position:fixed;top:20px;right:20px;background:#2e7d32;color:white;padding:14px 22px;border-radius:12px;font-size:15px;font-weight:bold;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:sans-serif;';
    document.body.appendChild(d);
    setTimeout(() => { d.remove(); window.close(); }, 1500);
    return;
  }

  // Salva cookie sempre que abrir o NextSite
  const match = document.cookie.match(/PHPSESSID=([^;]+)/);
  if (match) {
    const ps = JSON.stringify({ phpsessid: match[1] });
    fetch('https://duda-news-server.onrender.com/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ps });
    fetch('http://localhost:3000/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ps }).catch(() => {});
  }

  // Lê dados do ?tanaka= (base64) ou do sessionStorage (caso haja redirect)
  const rawUrl = new URLSearchParams(window.location.search).get('tanaka');
  if (rawUrl) sessionStorage.setItem('tanaka_pending', rawUrl);
  const raw = rawUrl || sessionStorage.getItem('tanaka_pending');
  if (!raw) return;

  let dados;
  try {
    dados = JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch (e) {
    return;
  }
  if (!dados || (!dados.titulo && !dados.texto)) return;

  sessionStorage.removeItem('tanaka_pending');

  // Aguarda um seletor aparecer na página (até 8s)
  function aguardar(seletor, tempo = 8000) {
    return new Promise((resolve) => {
      const inicio = Date.now();
      const iv = setInterval(() => {
        const el = document.querySelector(seletor);
        if (el) { clearInterval(iv); resolve(el); }
        else if (Date.now() - inicio > tempo) { clearInterval(iv); resolve(null); }
      }, 300);
    });
  }

  function set(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
  }

  function check(sel, val) {
    document.querySelectorAll(sel).forEach(r => { if (r.value === val) r.checked = true; });
  }

  function preencherTinyMCE(html) {
    if (typeof tinymce !== 'undefined' && tinymce.get('texto_con')) {
      tinymce.get('texto_con').setContent(html); return true;
    }
    const iframe = document.querySelector('#texto_con_ifr');
    if (iframe && iframe.contentDocument) {
      const body = iframe.contentDocument.querySelector('body');
      if (body) { body.innerHTML = html; return true; }
    }
    return false;
  }

  function mostrarAviso(msg, cor) {
    const d = document.createElement('div');
    d.innerHTML = msg;
    d.style.cssText = `position:fixed;top:20px;right:20px;background:${cor||'#c2185b'};color:white;padding:14px 22px;border-radius:12px;font-size:15px;font-weight:bold;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:sans-serif;max-width:360px;line-height:1.5;`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 6000);
  }

  async function preencher() {
    mostrarAviso('⏳ Preenchendo formulário...', '#7b1fa2');

    const inputTitulo = await aguardar('input[name="titulo_con"]');
    if (!inputTitulo) { mostrarAviso('❌ Campos não encontrados!', '#c62828'); return; }

    if (dados.titulo) set('input[name="titulo_con"]', dados.titulo);
    if (dados.chapeu) set('input[name="chapeu_con"]', dados.chapeu);
    set('input[name="local_con"]', 'Estadao Conteudo');
    check('input[name="publica_con"]', '0');
    check('input[name="publica"]', '0');

    setTimeout(() => {
      const elA = document.querySelector('input[name="autor_con"]');
      if (elA) { elA.value = ''; elA.value = dados.autor || 'Maria Eduarda'; }
    }, 400);

    if (dados.texto) {
      const html = dados.texto.split('\n\n').filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('');
      let ok = preencherTinyMCE(html);
      if (!ok) { await new Promise(r => setTimeout(r, 3000)); ok = preencherTinyMCE(html); }
      if (!ok) { await new Promise(r => setTimeout(r, 2000)); preencherTinyMCE(html); }
    }

    // Busca a foto
    if (dados.titulo) {
      setTimeout(async () => {
        const btnImg = document.querySelector('#img-capa-handler');
        if (!btnImg) return;
        btnImg.click();
        await new Promise(r => setTimeout(r, 1200));
        const inp = document.querySelector('input#q');
        if (!inp) return;
        const nomeBusca = dados.fotoNome || dados.titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 -]/g, '').replace(/ +/g, '-').substring(0, 60);
        inp.value = nomeBusca;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 800));
        const btnBuscar = document.querySelector('#btn-search');
        if (!btnBuscar) return;
        btnBuscar.click();
        let ti = 0;
        const iv = setInterval(() => {
          ti++;
          const img = document.querySelector('#dialog img.img-file');
          if (img) {
            clearInterval(iv);
            img.click();
            setTimeout(() => {
              const ins = document.querySelector('#insertBtn');
              if (ins) ins.click();
            }, 600);
          }
          if (ti > 30) clearInterval(iv);
        }, 300);
      }, 1000);
    }

    mostrarAviso('✅ Preenchido! Buscando: ' + (dados.fotoNome || 'título') + ' 🌸', '#c2185b');
  }

  if (document.readyState === 'complete') {
    setTimeout(preencher, 1500);
  } else {
    window.addEventListener('load', () => setTimeout(preencher, 1500));
  }

})();

// ─── Google Imagens HD ───────────────────────────────────────────────────────
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const isGoogleImagens = window.location.hostname === 'www.google.com' &&
    (params.get('udm') === '2' || params.get('tbm') === 'isch');
  if (!isGoogleImagens) return;


  setTimeout(() => {
    const urls = [];
    console.log('[Tanaka] Google Imagens: iniciando extração...');

    // Método 1: data-it → JSON → campo ou / purl / isu
    document.querySelectorAll('[data-it]').forEach(el => {
      if (urls.length >= 12) return;
      try {
        const data = JSON.parse(el.getAttribute('data-it'));
        const url = data.ou || data.purl || data.isu;
        if (url && /\.(jpg|jpeg|png|webp)/i.test(url) && !urls.includes(url))
          urls.push(url);
      } catch (e) {}
    });
    console.log('[Tanaka] Método 1 (data-it):', urls.length);

    // Método 2: outros atributos do Google
    if (urls.length < 12) {
      ['data-src', 'data-ow', 'data-tw', 'data-iurl'].forEach(attr => {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
          if (urls.length >= 12) return;
          const url = el.getAttribute(attr);
          if (url && /^https?:\/\/.+\.(jpg|jpeg|png|webp)/i.test(url) && !urls.includes(url))
            urls.push(url);
        });
      });
    }
    console.log('[Tanaka] Método 2 (atributos):', urls.length);

    // Método 3: scripts inline com JSON escapado
    if (urls.length < 12) {
      document.querySelectorAll('script').forEach(s => {
        if (urls.length >= 12) return;
        const matches = s.textContent.match(/https?:\\?\/\\?\/[^"'\s\\]+\.(?:jpg|jpeg|png|webp)/gi) || [];
        matches.forEach(raw => {
          if (urls.length >= 12) return;
          const url = raw.replace(/\\\//g, '/');
          if (!url.includes('google') && !url.includes('gstatic') && !urls.includes(url))
            urls.push(url);
        });
      });
    }
    console.log('[Tanaka] Método 3 (scripts):', urls.length);

    // Método 4: fallback — varredura no HTML
    if (urls.length < 12) {
      const found = document.documentElement.innerHTML.match(/https?:\/\/[^"' \s>]+\.(jpg|jpeg|png|webp)/gi) || [];
      found.forEach(url => {
        if (urls.length >= 12 || urls.includes(url)) return;
        if (url.includes('google.com') || url.includes('gstatic.com')) return;
        urls.push(url);
      });
    }
    console.log('[Tanaka] Método 4 (HTML):', urls.length, '| opener:', !!window.opener);

    if (urls.length === 0) { console.log('[Tanaka] Nenhuma URL encontrada!'); return; }

    const payload = urls.slice(0, 12);

    // Tenta postMessage para o app (funciona se window.opener não for null)
    let enviouPorOpener = false;
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({ type: 'IMAGENS_GOOGLE', data: payload }, '*');
        enviouPorOpener = true;
        try { window.opener.focus(); } catch(e) {} // volta foco pro app
        window.close(); // fecha imediatamente — postMessage é instantâneo
      } catch (e) {}
    }

    // Fallback: envia pro servidor como relay (tenta local e Render)
    if (!enviouPorOpener) {
      const body = JSON.stringify({ urls: payload });
      const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
      fetch('http://localhost:3000/google-imagens', opts).catch(() => {});
      fetch('https://duda-news-server.onrender.com/google-imagens', opts).catch(() => {});

      // Polling: fecha a aba quando o app confirmar que a foto foi enviada
      const ivFoto = setInterval(() => {
        Promise.any([
          fetch('http://localhost:3000/foto-enviada').then(r => r.json()),
          fetch('https://duda-news-server.onrender.com/foto-enviada').then(r => r.json()),
        ]).then(data => {
          if (data.foi) { clearInterval(ivFoto); window.close(); }
        }).catch(() => {});
      }, 1500);
      setTimeout(() => clearInterval(ivFoto), 10 * 60 * 1000); // para após 10min
    }

  }, 2500);
})();
