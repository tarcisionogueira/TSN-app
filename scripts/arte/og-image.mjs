/**
 * Gera o CARTÃO PADRÃO do site (1200×630) — `public/og-image.jpg`.
 *
 * É a imagem de QUASE TODO link compartilhado: a home, o link de indicação, os links com "#"
 * (que o robô de preview não lê além do domínio), os contratos e qualquer rota sem cartão
 * próprio. Trocar esta imagem melhora todos de uma vez — foi por isso que ela entrou junto
 * com o cartão da aula.
 *
 * As mesmas duas regras da capa da aula (ver scripts/arte/capa-aula.mjs), pelos mesmos
 * motivos medidos no WhatsApp: composição CENTRALIZADA (a miniatura é um recorte quadrado do
 * centro) e poucas palavras GRANDES (a miniatura tem ~100px). A versão anterior era um banner
 * alinhado à esquerda e chegava ao cliente como "eis de leilão com / ança e desconto".
 *
 * Render em 2× e JPEG 92 — o WhatsApp reamostra, e reamostrar a partir de 1200px serrilha.
 */
import fs from 'node:fs';
const NAVY = '#0B1B33', AZUL = '#0D63DB', LATAO = '#D8A94A';
const icone = `<svg width="128" height="128" viewBox="0 0 64 64" fill="none" stroke="${LATAO}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 28 L28 12 L48 28"/><path d="M13 26 V50 H43 V26"/><path d="M24 50 V38 H32 V50"/>
  <g transform="rotate(-38 47 22)"><rect x="38" y="15" width="20" height="9" rx="2.5" fill="${LATAO}" stroke="none"/><path d="M48 24 V40" stroke-width="4"/></g>
  <path d="M40 52 H58" stroke-width="5"/></svg>`;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
       background:${NAVY};overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center}
  .glow{position:absolute;border-radius:50%;filter:blur(110px)}
</style></head><body>
  <div class="glow" style="width:780px;height:780px;background:${AZUL};left:50%;top:50%;transform:translate(-50%,-50%);opacity:.5"></div>
  <div style="position:relative;width:640px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center">
    <div style="font-size:22px;font-weight:900;letter-spacing:6px;color:${LATAO}">BIDPRO BRASIL</div>
    ${icone}
    <div style="font-size:100px;font-weight:900;line-height:.94;letter-spacing:-3px;color:#fff;text-shadow:0 4px 30px rgba(0,0,0,.4)">
      IMÓVEIS<br>DE LEILÃO
    </div>
    <div style="background:${LATAO};color:${NAVY};font-size:36px;font-weight:900;letter-spacing:-.3px;
                padding:11px 26px;border-radius:12px;white-space:nowrap">ANÁLISE · ASSESSORIA</div>
  </div>
</body></html>`;
fs.writeFileSync(new URL('./og-image.html', import.meta.url), html);
console.log('HTML escrito em scripts/arte/og-image.html. Para virar JPEG + o teste de miniatura:');
console.log(`  node -e "import('playwright').then(async({chromium})=>{
    const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
    const p=await b.newPage({viewport:{width:1200,height:630},deviceScaleFactor:2});
    await p.goto('file://'+process.cwd()+'/scripts/arte/og-image.html');
    await p.screenshot({path:'public/og-image.jpg',type:'jpeg',quality:92});
    await p.screenshot({path:'/tmp/og-quadrada.jpg',type:'jpeg',quality:92,clip:{x:285,y:0,width:630,height:630}});
    await b.close()})"`);
