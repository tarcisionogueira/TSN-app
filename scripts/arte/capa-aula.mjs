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
 * Como rodar (precisa do Chromium do Playwright):
 *   node scripts/arte/capa-aula.mjs && npx playwright screenshot ... (ver README do diretório)
 */
import fs from 'node:fs';
const NAVY = '#0B1B33', AZUL = '#0D63DB', LATAO = '#D8A94A';
// CENTRALIZADA: o WhatsApp mostra miniatura QUADRADA em vários clientes, e o quadrado é o
// centro da imagem (x de 285 a 915 num 1200×630). Tudo que importa mora nessa faixa.
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
       background:${NAVY};color:#EAF0F8;overflow:hidden;position:relative;display:flex;
       align-items:center;justify-content:center;text-align:center}
  .glow{position:absolute;border-radius:50%;filter:blur(100px)}
</style></head><body>
  <div class="glow" style="width:700px;height:700px;background:${AZUL};left:50%;top:50%;transform:translate(-50%,-50%);opacity:.45"></div>
  <div class="glow" style="width:360px;height:360px;background:${LATAO};left:-140px;bottom:-190px;opacity:.20"></div>
  <div class="glow" style="width:360px;height:360px;background:${LATAO};right:-140px;top:-190px;opacity:.16"></div>
  <div style="position:relative;width:600px;display:flex;flex-direction:column;align-items:center;gap:22px">
    <div style="background:${LATAO};color:${NAVY};font-size:19px;font-weight:900;letter-spacing:3.5px;
                text-transform:uppercase;padding:10px 22px;border-radius:8px;white-space:nowrap">
      Aula ao vivo · grátis
    </div>
    <div style="font-size:54px;font-weight:900;line-height:1.1;letter-spacing:-1.2px;color:#fff">
      Como encontrar<br>e avaliar um imóvel<br>de leilão
    </div>
    <div style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.10);
                border:1px solid rgba(255,255,255,.22);padding:12px 26px;border-radius:12px">
      <span style="font-size:27px;font-weight:900;color:#fff;letter-spacing:.5px;white-space:nowrap">TODA QUARTA · 19H</span>
    </div>
    <div style="font-size:19px;color:#9FB3CC;font-weight:600">bidprobrasil.com.br</div>
  </div>
</body></html>`;
fs.writeFileSync(new URL('./capa.html', import.meta.url), html);

console.log('HTML escrito em scripts/arte/capa.html. Para virar PNG 1200x630 + o recorte quadrado:');
console.log(`  node -e "import('playwright').then(async({chromium})=>{
    const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
    const p=await b.newPage({viewport:{width:1200,height:630}});
    await p.goto('file://'+process.cwd()+'/scripts/arte/capa.html');
    await p.screenshot({path:'public/capa-aula-leilao-ao-vivo.png'});
    await p.screenshot({path:'/tmp/capa-quadrada.png',clip:{x:285,y:0,width:630,height:630}});
    await b.close()})"`);
