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
 * Como rodar (precisa do Chromium do Playwright):
 *   node scripts/arte/capa-aula.mjs && npx playwright screenshot ... (ver README do diretório)
 */
import fs from 'node:fs';
const NAVY = '#0B1B33', AZUL = '#0D63DB', LATAO = '#D8A94A';
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  @page{margin:0} *{box-sizing:border-box}
  body{margin:0;width:1200px;height:630px;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
       background:${NAVY};color:#EAF0F8;overflow:hidden;position:relative}
  .glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
</style></head><body>
  <div class="glow" style="width:620px;height:620px;background:${AZUL};right:-160px;top:-220px"></div>
  <div class="glow" style="width:420px;height:420px;background:${LATAO};left:-180px;bottom:-230px;opacity:.22"></div>
  <div style="position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between">
    <div>
      <div style="display:inline-block;background:${LATAO}1F;border:1px solid ${LATAO}66;color:${LATAO};
                  font-size:17px;font-weight:800;letter-spacing:3px;text-transform:uppercase;padding:10px 20px;border-radius:30px">
        Aula ao vivo · gratuita
      </div>
      <div style="font-size:62px;font-weight:900;line-height:1.08;letter-spacing:-1.4px;margin:30px 0 0;max-width:940px;color:#fff">
        Como eu encontro e avalio<br>um imóvel de leilão
      </div>
      <div style="font-size:25px;color:#B9C8DC;line-height:1.5;margin-top:20px;max-width:820px">
        Busca ao vivo na plataforma e um laudo de viabilidade com IA gerado na hora.
      </div>
    </div>
    <div style="display:flex;align-items:flex-end;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="background:#fff;color:${NAVY};font-size:24px;font-weight:900;letter-spacing:.5px;padding:14px 24px;border-radius:12px">
          TODA QUARTA · 19H
        </div>
        <div style="font-size:19px;color:#8FA4BF;font-weight:600">horário de Brasília</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:800;color:#fff">Tarcísio Nogueira</div>
        <div style="font-size:17px;color:#8FA4BF;margin-top:2px">bidprobrasil.com.br</div>
      </div>
    </div>
  </div>
</body></html>`;
fs.writeFileSync(new URL('./capa.html', import.meta.url), html);
console.log('HTML escrito. Para virar PNG 1200x630 (Chromium do Playwright):');
console.log("  node -e \"import('playwright').then(async({chromium})=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});const p=await b.newPage({viewport:{width:1200,height:630}});await p.goto('file://'+process.cwd()+'/scripts/arte/capa.html');await p.screenshot({path:'public/capa-aula-leilao-ao-vivo.png'});await b.close()})\"");
