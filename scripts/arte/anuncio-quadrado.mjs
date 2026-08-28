/**
 * Criativo QUADRADO do anúncio (1200×1200) — `public/anuncio-aula-quadrado.jpg`.
 *
 * O OpenAI Ads (ChatGPT Ads) pede imagem QUADRADA (mín. 256×256) e mostra o anúncio como um
 * bloco pequeno ao lado do texto. Mandar a capa 1200×630 funcionaria — a composição já é
 * centralizada, então sobrevive ao corte —, mas perde metade da área útil e chega reamostrada.
 * Esta versão nasce no formato que o canal usa.
 *
 * Mesmas regras da capa da aula (ver scripts/arte/capa-aula.mjs): poucas palavras GRANDES
 * (o bloco é pequeno), o TEMA em primeiro plano e o quando em selo, render em 2× e JPEG 92.
 */
import fs from 'node:fs';
const NAVY = '#0B1B33', AZUL = '#0D63DB', LATAO = '#D8A94A';
const icone = `<svg width="190" height="190" viewBox="0 0 64 64" fill="none" stroke="${LATAO}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 28 L28 12 L48 28"/><path d="M13 26 V50 H43 V26"/><path d="M24 50 V38 H32 V50"/>
  <g transform="rotate(-38 47 22)"><rect x="38" y="15" width="20" height="9" rx="2.5" fill="${LATAO}" stroke="none"/><path d="M48 24 V40" stroke-width="4"/></g>
  <path d="M40 52 H58" stroke-width="5"/></svg>`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:1200px;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
       background:${NAVY};overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center}
  .glow{position:absolute;border-radius:50%;filter:blur(120px)}
</style></head><body>
  <div class="glow" style="width:1000px;height:1000px;background:${AZUL};left:50%;top:50%;transform:translate(-50%,-50%);opacity:.5"></div>
  <div style="position:relative;width:940px;display:flex;flex-direction:column;align-items:center;gap:30px;text-align:center">
    <div style="font-size:30px;font-weight:900;letter-spacing:8px;color:${LATAO}">BIDPRO BRASIL</div>
    ${icone}
    <div style="font-size:132px;font-weight:900;line-height:.94;letter-spacing:-4px;color:#fff;text-shadow:0 4px 34px rgba(0,0,0,.4)">
      IMÓVEIS<br>DE LEILÃO
    </div>
    <div style="background:${LATAO};color:${NAVY};font-size:52px;font-weight:900;letter-spacing:-.5px;
                padding:16px 34px;border-radius:16px;white-space:nowrap">AO VIVO · QUARTA 19H</div>
    <div style="font-size:30px;font-weight:700;color:#9FB3CC">aula gratuita</div>
  </div>
</body></html>`;
fs.writeFileSync(new URL('./anuncio-quadrado.html', import.meta.url), html);
console.log('HTML escrito. Para virar JPEG 1200x1200:');
console.log(`  node -e "import('playwright').then(async({chromium})=>{
    const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
    const p=await b.newPage({viewport:{width:1200,height:1200},deviceScaleFactor:2});
    await p.goto('file://'+process.cwd()+'/scripts/arte/anuncio-quadrado.html');
    await p.screenshot({path:'public/anuncio-aula-quadrado.jpg',type:'jpeg',quality:92});
    await b.close()})"`);
