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
 * Como rodar (precisa do Chromium do Playwright):
 *   node scripts/arte/capa-aula.mjs && npx playwright screenshot ... (ver README do diretório)
 */
import fs from 'node:fs';
const NAVY = '#0B1B33', AZUL = '#0D63DB', LATAO = '#D8A94A';
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
       background:${NAVY};overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center}
  .glow{position:absolute;border-radius:50%;filter:blur(110px)}
</style></head><body>
  <div class="glow" style="width:760px;height:760px;background:${AZUL};left:50%;top:50%;transform:translate(-50%,-50%);opacity:.5"></div>
  <div style="position:relative;width:620px;display:flex;flex-direction:column;align-items:center;gap:26px;text-align:center">
    <div style="font-size:118px;font-weight:900;line-height:.92;letter-spacing:-3px;color:#fff;text-shadow:0 4px 30px rgba(0,0,0,.35)">
      AULA<br>AO VIVO
    </div>
    <div style="background:${LATAO};color:${NAVY};font-size:56px;font-weight:900;letter-spacing:-1px;
                padding:14px 34px;border-radius:14px;white-space:nowrap">QUARTA · 19H</div>
    <div style="font-size:29px;font-weight:800;color:#9FB3CC;letter-spacing:.5px">imóveis de leilão · grátis</div>
  </div>
</body></html>`;
fs.writeFileSync(new URL('./capa.html', import.meta.url), html);

console.log('HTML escrito em scripts/arte/capa.html. Para virar PNG + os dois testes:');
console.log(`  node -e "import('playwright').then(async({chromium})=>{
    const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
    const p=await b.newPage({viewport:{width:1200,height:630}});
    await p.goto('file://'+process.cwd()+'/scripts/arte/capa.html');
    await p.screenshot({path:'public/capa-aula-leilao-ao-vivo.png'});
    await p.screenshot({path:'/tmp/capa-quadrada.png',clip:{x:285,y:0,width:630,height:630}});
    await b.close()})"`);
console.log('Depois olhe /tmp/capa-quadrada.png REDUZIDO a 100px — é o tamanho real da miniatura.');
