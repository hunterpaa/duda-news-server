/**
 * setup.js — Tanaka Sports
 * Baixa os arquivos do GitHub, aplica correções e prepara tudo pra rodar local.
 *
 * Como usar:
 *   1. Coloca esse arquivo em qualquer pasta (ex: C:\tanaka-sports\)
 *   2. Abre o terminal nessa pasta
 *   3. Roda: node setup.js
 *   4. Depois: npm install
 *   5. Depois: node server.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const PASTA = __dirname; // mesma pasta do setup.js

const ARQUIVOS = [
  {
    nome: 'server.js',
    url: 'https://raw.githubusercontent.com/hunterpaa/duda-news-server/main/server.js',
  },
  {
    nome: 'app-duda.html',
    url: 'https://raw.githubusercontent.com/hunterpaa/duda-news-server/main/app-duda.html',
  },
];

// Correções a aplicar no app-duda.html após baixar
const CORRECOES_HTML = [
  {
    descricao: 'Troca servidor Render pelo localhost',
    de: `const SERVER = 'https://duda-news-server.onrender.com';`,
    para: `const SERVER = 'http://localhost:3000';`,
  },
  {
    descricao: 'Remove hífens do nome sugerido da foto (usa espaço)',
    de: `return escolhidas.map(p => p.toLowerCase()).join('-') || 'foto-esporte';`,
    para: `return escolhidas.map(p => p.toLowerCase()).join(' ') || 'foto esporte';`,
  },
  {
    descricao: 'Atualiza placeholder do campo nome da foto',
    de: `placeholder="Ex: gremio-inter"`,
    para: `placeholder="Ex: gremio inter"`,
  },
];

// package.json com todas as dependências
const PACKAGE_JSON = {
  name: 'tanaka-sports',
  version: '1.0.0',
  description: 'Servidor local Tanaka Sports da Duda',
  main: 'server.js',
  scripts: {
    start: 'node server.js',
  },
  dependencies: {
    express: '^4.18.2',
    axios: '^1.6.0',
    cheerio: '^1.0.0',
    cors: '^2.8.5',
    'form-data': '^4.0.0',
  },
};

// ── Funções auxiliares ──────────────────────────────────────────────

function baixar(url, destino) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destino);
    https.get(url, (res) => {
      // Segue redirecionamentos
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return baixar(res.headers.location, destino).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ao baixar ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlink(destino, () => {});
      reject(err);
    });
  });
}

function aplicarCorrecoes(arquivo, correcoes) {
  let conteudo = fs.readFileSync(arquivo, 'utf8');
  let aplicadas = 0;
  for (const c of correcoes) {
    if (conteudo.includes(c.de)) {
      conteudo = conteudo.replace(c.de, c.para);
      console.log(`  ✅ ${c.descricao}`);
      aplicadas++;
    } else {
      console.log(`  ⚠️  Não encontrado (já aplicado?): ${c.descricao}`);
    }
  }
  fs.writeFileSync(arquivo, conteudo, 'utf8');
  return aplicadas;
}

// ── Script principal ────────────────────────────────────────────────

async function main() {
  console.log('\n🌸 Tanaka Sports — Setup Local\n');
  console.log(`📁 Pasta: ${PASTA}\n`);

  // 1. Cria o package.json
  const pkgPath = path.join(PASTA, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify(PACKAGE_JSON, null, 2), 'utf8');
  console.log('✅ package.json criado');

  // 2. Baixa os arquivos do GitHub
  console.log('\n⬇️  Baixando arquivos do GitHub...');
  for (const arq of ARQUIVOS) {
    const destino = path.join(PASTA, arq.nome);
    process.stdout.write(`   ${arq.nome}... `);
    try {
      await baixar(arq.url, destino);
      console.log('✅');
    } catch (e) {
      console.log(`❌ Erro: ${e.message}`);
      process.exit(1);
    }
  }

  // 3. Aplica correções no app-duda.html
  console.log('\n🔧 Aplicando correções no app-duda.html...');
  const htmlPath = path.join(PASTA, 'app-duda.html');
  aplicarCorrecoes(htmlPath, CORRECOES_HTML);

  // 4. Instruções finais
  console.log('\n─────────────────────────────────────────');
  console.log('✅ Tudo pronto! Agora rode:\n');
  console.log('   npm install');
  console.log('   node server.js\n');
  console.log('Depois abre o app-duda.html no navegador 🌸');
  console.log('─────────────────────────────────────────\n');
}

main().catch(e => {
  console.error('❌ Erro fatal:', e.message);
  process.exit(1);
});
