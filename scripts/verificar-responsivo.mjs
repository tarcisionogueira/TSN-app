#!/usr/bin/env node
/**
 * Verificador de RESPONSIVIDADE — mede o que hoje só era descoberto pelo dono no iPhone.
 *
 * POR QUE EXISTE (14/08). Num dia só apareceram quatro defeitos de tela que nenhuma trava do
 * projeto pegava, porque nenhuma delas OLHA a página renderizada:
 *   1. iOS dando zoom sozinho ao focar campo com fonte < 16px (a tela "perdia a escala");
 *   2. rolagem horizontal indevida, com conteúdo cortado à direita;
 *   3. botões flutuantes (voltar, chat) cobrindo a barra de ações do imóvel;
 *   4. tabela de comparação escondendo uma coluna inteira no celular.
 * O `verificar:padroes` lê código, o `verificar:schema` lê o banco. Faltava alguém que
 * ABRISSE a tela em vários tamanhos e conferisse. É o que este script faz.
 *
 * O QUE ELE REPROVA (só o que é objetivamente defeito, para não virar ruído):
 *   • `scrollWidth > clientWidth` — a página empurra rolagem lateral;
 *   • campo de formulário com fonte < 16px em tela de toque — o iOS dá zoom e a pessoa
 *     precisa afastar com os dedos para voltar. É a causa-raiz do relato de 14/08;
 *   • elemento fixo/sticky sobrepondo outro elemento fixo/sticky — a origem do item 3;
 *   • erro de JavaScript na página (pageerror) — tela quebrada não é problema de layout,
 *     mas se aparecer aqui é melhor saber agora.
 *
 * USO:
 *   node scripts/verificar-responsivo.mjs                      (usa http://localhost:4173)
 *   node scripts/verificar-responsivo.mjs https://…vercel.app  (mede o deploy)
 *   ROTAS=/,/alavancagem node scripts/verificar-responsivo.mjs (mede só o que interessa)
 *
 * NÃO está no `prebuild` de propósito: precisa de um servidor de pé e do Chromium, e pôr
 * isso no caminho do deploy trocaria uma classe de falha por outra — a mesma razão pela qual
 * o `verificar:schema` também ficou fora. Rode ao mexer em tela.
 */

const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:4173';

// Só rotas PÚBLICAS: sem login, o script roda em qualquer lugar sem segredo nenhum.
//
// `/leiloes` entrou em 15/08 e é a única servida FORA do SPA (`api/publico.js`, por rewrite
// do vercel.json). Ficou de fora da varredura de 14/08 exatamente por isso — e foi onde o
// dono achou o cabeçalho destoando do resto do site no dia seguinte. Uma rota que ninguém
// mede é uma rota que só o cliente testa.
//
// ⚠️ Ela só existe quando há servidor com o rewrite: contra `dist` estático (o preview
// local padrão) devolve 404, então rode a varredura completa contra o DEPLOY —
// `npm run verificar:responsivo https://www.bidprobrasil.com.br` — ou limite as rotas com
// a variável ROTAS quando estiver medindo só telas do app.
const ROTAS = (process.env.ROTAS || '/,/alavancagem,/planos,/login,/calculadora,/termos,/privacidade,/leiloes')
  .split(',').map((r) => r.trim()).filter(Boolean);

// Larguras reais de aparelho, do menor Android em uso ao desktop.
const LARGURAS = [
  { nome: 'android-320', w: 320, h: 640, toque: true },
  { nome: 'iphone-se-375', w: 375, h: 667, toque: true },
  { nome: 'iphone-390', w: 390, h: 844, toque: true },
  { nome: 'iphone-max-430', w: 430, h: 932, toque: true },
  { nome: 'tablet-768', w: 768, h: 1024, toque: true },
  { nome: 'desktop-1280', w: 1280, h: 900, toque: false },
];

async function carregarChromium() {
  const candidatos = ['playwright', '/opt/node22/lib/node_modules/playwright/index.js'];
  for (const c of candidatos) {
    try {
      const mod = await import(c);
      return (mod.chromium || mod.default?.chromium);
    } catch { /* tenta o próximo */ }
  }
  return null;
}

const chromium = await carregarChromium();
if (!chromium) {
  // Não conseguir verificar NÃO é "está tudo bem" — mas aqui a ausência do Chromium é de
  // ambiente, não do código. Sai com 0 avisando alto, para não travar quem não o tem.
  console.log('⚠️  Playwright/Chromium não encontrado. Verificação de responsividade PULADA.');
  process.exit(0);
}

const achados = [];
const navegador = await chromium.launch();

for (const dev of LARGURAS) {
  const ctx = await navegador.newContext({
    viewport: { width: dev.w, height: dev.h },
    isMobile: dev.toque,
    hasTouch: dev.toque,
    deviceScaleFactor: 1,
  });
  for (const rota of ROTAS) {
    const pag = await ctx.newPage();
    const erros = [];
    pag.on('pageerror', (e) => erros.push(String(e?.message || e)));
    try {
      // `domcontentloaded` e não `networkidle`: fonte externa e API bloqueadas (sandbox, rede
      // ruim) fazem o networkidle esperar o timeout inteiro por rota — o script levava minutos
      // e não terminava. O que interessa aqui já está pintado depois da hidratação.
      await pag.goto(`${BASE}/#${rota}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await pag.waitForTimeout(1200);
    } catch (e) {
      achados.push({ dev: dev.nome, rota, tipo: 'carregamento', detalhe: String(e?.message || e).slice(0, 160) });
      await pag.close();
      continue;
    }

    const r = await pag.evaluate(() => {
      const out = { overflow: null, camposPequenos: [], sobreposicoes: [] };

      // 1. Rolagem horizontal
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) {
        // Aponta o culpado: o elemento visível que passa da borda direita.
        const culpados = [...document.querySelectorAll('body *')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => r.width > 0 && r.right > de.clientWidth + 1 && getComputedStyle(el).position !== 'fixed')
          .slice(0, 3)
          .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} (right=${Math.round(r.right)})`);
        out.overflow = { scrollW: de.scrollWidth, clientW: de.clientWidth, culpados };
      }

      // 2. Campo com fonte < 16px (zoom automático do iOS ao focar)
      for (const el of document.querySelectorAll('input, select, textarea')) {
        const t = (el.getAttribute('type') || '').toLowerCase();
        if (['checkbox', 'radio', 'range', 'hidden', 'submit', 'button'].includes(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // invisível
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 16) out.camposPequenos.push(`${el.tagName.toLowerCase()}${t ? `[${t}]` : ''} ${fs}px`);
      }

      // 3. Elementos fixos/sticky sobrepostos entre si
      const fixos = [...document.querySelectorAll('body *')].filter((el) => {
        const p = getComputedStyle(el).position;
        if (p !== 'fixed' && p !== 'sticky') return false;
        const r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden';
      });
      const rotulo = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''}`;
      for (let i = 0; i < fixos.length; i++) {
        for (let j = i + 1; j < fixos.length; j++) {
          if (fixos[i].contains(fixos[j]) || fixos[j].contains(fixos[i])) continue;
          const a = fixos[i].getBoundingClientRect(), b = fixos[j].getBoundingClientRect();
          const larg = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const alt = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (larg > 4 && alt > 4) out.sobreposicoes.push(`${rotulo(fixos[i])} × ${rotulo(fixos[j])}`);
        }
      }
      return out;
    });

    if (r.overflow) achados.push({ dev: dev.nome, rota, tipo: 'rolagem-horizontal', detalhe: `${r.overflow.scrollW}px de conteúdo em ${r.overflow.clientW}px de tela · ${r.overflow.culpados.join(' · ') || 'sem culpado identificado'}` });
    if (dev.toque && r.camposPequenos.length) achados.push({ dev: dev.nome, rota, tipo: 'zoom-ios', detalhe: [...new Set(r.camposPequenos)].join(' · ') });
    for (const s of [...new Set(r.sobreposicoes)]) achados.push({ dev: dev.nome, rota, tipo: 'fixos-sobrepostos', detalhe: s });
    for (const e of erros) achados.push({ dev: dev.nome, rota, tipo: 'erro-js', detalhe: e.slice(0, 160) });

    await pag.close();
  }
  await ctx.close();
}
await navegador.close();

if (!achados.length) {
  console.log(`✓ Responsividade OK em ${LARGURAS.length} tamanhos × ${ROTAS.length} rotas (${BASE}).`);
  process.exit(0);
}

console.log(`\n✗ ${achados.length} achado(s) de responsividade em ${BASE}:\n`);
const porTipo = achados.reduce((acc, a) => { (acc[a.tipo] ||= []).push(a); return acc; }, {});
for (const [tipo, lista] of Object.entries(porTipo)) {
  console.log(`  ${tipo} (${lista.length})`);
  for (const a of lista) console.log(`    · ${a.dev.padEnd(14)} ${a.rota.padEnd(16)} ${a.detalhe}`);
  console.log('');
}
process.exit(1);
