/**
 * Gera a CAPA da aula ao vivo (1200×630) — a imagem do cartão de compartilhamento.
 *
 * Fica versionada porque a arte precisa ser REFEITA quando o título ou o horário da aula
 * mudarem, e refazer no Canva é redesenhar do zero. Sai em `public/capa-aula-<slug>.png`.
 *
 * ⚠️ SEM DATA NA IMAGEM, DE PROPÓSITO. A aula é semanal: uma capa com "02/09" vira mentira na
 * quarta seguinte, e ninguém lembra de trocar a imagem. A data exata vai no TÍTULO do cartão,
 * que o `api/og-share` lê do banco a cada compartilhamento e por isso está sempre certo. A
 * imagem carrega só o que não muda: "toda quarta · 19h".
 *
 * ⚠️ COMPOSIÇÃO CENTRALIZADA, e isso não é gosto: o WhatsApp mostra a prévia como MINIATURA
 * QUADRADA em vários clientes (Web/Desktop, e no telefone quando a imagem não vira card
 * grande), e o quadrado é o CENTRO da imagem — num 1200×630, o recorte vai de x=285 a x=915.
 * A primeira versão era alinhada à esquerda e o corte comia o texto: o dono viu "eu encontro
 * e aval / óvel de leilão" no lugar do título. Tudo que precisa ser lido mora dentro da faixa
 * central de 630px. Para conferir um redesenho, gere também o recorte quadrado antes de subir.
 *
 * ⚠️ A MINIATURA TEM ~100 PIXELS, e é assim que a maioria vai ver. Nesse tamanho NENHUM título
 * de três linhas se lê — a segunda versão desta capa foi enquadrada certo e continuou
 * ilegível. A imagem carrega 3 ou 4 palavras ENORMES (o que é + quando), e o conteúdo fica no
 * TÍTULO do cartão, que o WhatsApp mostra como texto legível ao lado. Imagem e texto se
 * completam; duplicar o título na arte custa o único recurso escasso, que é o tamanho da letra.
 * Antes de subir um redesenho, olhe o recorte quadrado REDUZIDO A 100px: se não ler ali, não
 * adianta ler no monitor.
 *
 * ⚠️ A IMAGEM PRECISA DIZER DO QUE É A AULA. A v3 tinha "AULA AO VIVO" gigante — legível, e
 * sobre nada: o formato ocupava o lugar do TEMA. Quem recebe o link já vê "ao vivo" no texto
 * do cartão; o que a imagem tem de entregar em 100px é o assunto. Agora o que domina é
 * "IMÓVEIS DE LEILÃO" + o ícone de casa/martelo, e o quando vira o selo embaixo.
 *
 * ⚠️ JPEG, E SEM QUERY STRING NA URL. O PNG do degradê dava 185 KB e a imagem chegou a NÃO
 * aparecer no WhatsApp; o JPEG 88 dá ~55 KB sem perda visível num fundo de degradê. E a
 * versão vai no NOME do arquivo, não em `?v=`: robô de preview e CDN lidam com caminho novo
 * de forma previsível, com query nem sempre.
 *
 * Como rodar (precisa do Chromium do Playwright):
 *   node scripts/arte/capa-aula.mjs && npx playwright screenshot ... (ver README do diretório)
 */
import fs from 'node:fs';
const NAVY = '#0B1B33', AZUL = '#0D63DB', LATAO = '#D8A94A';
// Ícone: casa + martelo de leilão, desenhado em SVG (emoji não é confiável no headless).
const icone = `<svg width="150" height="150" viewBox="0 0 64 64" fill="none" stroke="${LATAO}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 28 L28 12 L48 28"/>
  <path d="M13 26 V50 H43 V26"/>
  <path d="M24 50 V38 H32 V50"/>
  <g transform="rotate(-38 47 22)">
    <rect x="38" y="15" width="20" height="9" rx="2.5" fill="${LATAO}" stroke="none"/>
    <path d="M48 24 V40" stroke-width="4"/>
  </g>
  <path d="M40 52 H58" stroke-width="5"/>
</svg>`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
       background:${NAVY};overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center}
  .glow{position:absolute;border-radius:50%;filter:blur(110px)}
</style></head><body>
  <div class="glow" style="width:780px;height:780px;background:${AZUL};left:50%;top:50%;transform:translate(-50%,-50%);opacity:.52"></div>
  <div style="position:relative;width:640px;display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center">
    ${icone}
    <div style="font-size:104px;font-weight:900;line-height:.94;letter-spacing:-3px;color:#fff;text-shadow:0 4px 30px rgba(0,0,0,.4)">
      IMÓVEIS<br>DE LEILÃO
    </div>
    <div style="background:${LATAO};color:${NAVY};font-size:41px;font-weight:900;letter-spacing:-.5px;
                padding:12px 28px;border-radius:12px;white-space:nowrap">AO VIVO · QUARTA 19H</div>
  </div>
</body></html>`;
fs.writeFileSync(new URL('./capa.html', import.meta.url), html);

console.log('HTML escrito em scripts/arte/capa.html. Para virar JPEG + o teste de miniatura:');
console.log(`  node -e "import('playwright').then(async({chromium})=>{
    const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
    const p=await b.newPage({viewport:{width:1200,height:630}});
    await p.goto('file://'+process.cwd()+'/scripts/arte/capa.html');
    await p.screenshot({path:'public/capa-aula-imoveis-leilao.jpg',type:'jpeg',quality:88});
    await p.screenshot({path:'/tmp/capa-quadrada.jpg',type:'jpeg',quality:88,clip:{x:285,y:0,width:630,height:630}});
    await b.close()})"`);
console.log('Olhe /tmp/capa-quadrada.jpg REDUZIDO a 100px: e o tamanho real da miniatura no celular.');
