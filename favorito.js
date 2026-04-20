// Favorito (bookmarklet) do NextSite — cole na barra de favoritos como javascript:(function(){...})()
// Para usar como bookmarklet: minifique e prefixe com javascript:

(function(){
  const raw = new URLSearchParams(window.location.search).get('tanaka');
  const match = document.cookie.match(/PHPSESSID=([^;]+)/);

  if (match) {
    const ps = JSON.stringify({ phpsessid: match[1] });
    fetch('https://duda-news-server.onrender.com/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ps });
    fetch('http://localhost:3000/cookie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ps }).catch(() => {});
  }

  if (!raw) {
    const d = document.createElement('div');
    d.innerHTML = 'Cookie salvo!';
    d.style.cssText = 'position:fixed;top:20px;right:20px;background:#7b1fa2;color:white;padding:14px 22px;border-radius:12px;font-size:15px;font-weight:bold;z-index:99999;font-family:sans-serif;';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
    return;
  }

  const dados = JSON.parse(decodeURIComponent(escape(atob(raw))));

  function set(sel, val) {
    const el = document.querySelector(sel);
    if (el) {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('keyup', { bubbles: true }));
    }
  }

  function check(sel, val) {
    document.querySelectorAll(sel).forEach(r => { if (r.value === val) r.checked = true; });
  }

  if (dados.titulo) set('input[name="titulo_con"]', dados.titulo);
  if (dados.chapeu) set('input[name="chapeu_con"]', dados.chapeu);
  set('input[name="local_con"]', 'Estadao Conteudo');

  setTimeout(() => {
    const elA = document.querySelector('input[name="autor_con"]');
    if (elA) { elA.value = ''; elA.value = dados.autor || 'Maria Eduarda'; }
  }, 300);

  check('input[name="publica_con"]', '0');
  check('input[name="publica"]', '0');

  if (dados.texto) {
    const h = dados.texto.split('\n\n').filter(p => p.trim()).map(p => '<p>' + p.trim() + '</p>').join('');
    if (typeof tinymce !== 'undefined' && tinymce.get('texto_con')) {
      tinymce.get('texto_con').setContent(h);
    } else {
      const i = document.querySelector('#texto_con_ifr');
      if (i && i.contentDocument) {
        const b = i.contentDocument.querySelector('body');
        if (b) b.innerHTML = h;
      }
    }
  }

  if (dados.titulo) {
    setTimeout(() => {
      const btnImg = document.querySelector('#img-capa-handler');
      if (!btnImg) return;
      btnImg.click();
      setTimeout(() => {
        const inp = document.querySelector('input#q');
        if (!inp) return;
        const nomeBusca = dados.fotoNome || dados.titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 -]/g, '').replace(/ +/g, '-').substring(0, 60);
        inp.value = nomeBusca;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => {
          const btnBuscar = document.querySelector('#btn-search');
          if (!btnBuscar) return;
          btnBuscar.click();
          let ti = 0;
          const clicarImg = setInterval(() => {
            ti++;
            const img = document.querySelector('#dialog img.img-file');
            if (img) {
              clearInterval(clicarImg);
              img.click();
              setTimeout(() => {
                const ins = document.querySelector('#insertBtn');
                if (ins) ins.click();
              }, 600);
            }
            if (ti > 30) clearInterval(clicarImg);
          }, 300);
        }, 800);
      }, 1200);
    }, 1000);
  }

  const d = document.createElement('div');
  d.innerHTML = 'Preenchido! Buscando: ' + (dados.fotoNome || 'título') + ' 🌸';
  d.style.cssText = 'position:fixed;top:20px;right:20px;background:#c2185b;color:white;padding:14px 22px;border-radius:12px;font-size:15px;font-weight:bold;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:sans-serif;max-width:360px;';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 6000);
})();
