/**
 * RECON/COLHEITA do HASTA via CONSOLE DO NAVEGADOR (ideia do dono, 21/08).
 * =======================================================================
 * O site hastaleilao.com.br devolve 403 a IP de DATACENTER e só renderiza o dado no
 * navegador — do SEU navegador (IP residencial) os dois bloqueios não existem. Este
 * script roda no console e faz duas coisas:
 *
 *   1. DESCOBERTA DE API: intercepta todo fetch/XHR que devolver JSON enquanto a página
 *      navega. Se a SPA busca os lotes numa API JSON, o endpoint aparece aqui — e aí o
 *      scraper pode chamar a API direto (do runner residencial), sem renderizar nada.
 *   2. COLHEITA: abre cada /lote/<id>/<slug> da home num iframe OCULTO (mesma origem — a
 *      SPA renderiza normal), espera hidratar e extrai o texto renderizado + os PDFs.
 *      No fim, copia um JSON para a área de transferência (e loga no console).
 *
 * COMO USAR (1 minuto):
 *   1. Abra https://www.hastaleilao.com.br/ no Chrome.
 *   2. F12 → aba Console → cole este arquivo INTEIRO → Enter.
 *   3. (Opcional p/ descoberta) navegue até um lote qualquer e volte — os endpoints JSON
 *      capturados aparecem com o prefixo [API].
 *   4. Aguarde "COLHEITA CONCLUÍDA" (~2 min para ~18 lotes). O JSON já está no clipboard —
 *      cole num arquivo/na conversa com o Claude.
 *
 * NÃO grava nada em lugar nenhum: só lê e copia. Via canônica de coleta contínua é o
 * runner-residencial.sh (linha HASTA) — este console é diagnóstico/colheita pontual.
 */
(async () => {
  const MAX_LOTES = Number(window.HASTA_MAX || 40);
  const ESPERA_MS = 4500;

  // ── 1) Descoberta de API: loga todo JSON que a SPA buscar daqui em diante ──
  if (!window.__hastaSpyOn) {
    window.__hastaSpyOn = true;
    const _fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const r = await _fetch(...args);
      try {
        const ct = r.headers.get('content-type') || '';
        if (/json/i.test(ct)) {
          const txt = await r.clone().text();
          console.log(`[API] ${String(args[0]).slice(0, 160)} (${txt.length}b) →`, txt.slice(0, 400));
        }
      } catch { /* espião nunca quebra a página */ }
      return r;
    };
    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) {
      this.addEventListener('load', () => {
        try {
          const ct = this.getResponseHeader('content-type') || '';
          if (/json/i.test(ct)) console.log(`[API/xhr] ${String(u).slice(0, 160)} →`, String(this.responseText).slice(0, 400));
        } catch { /* idem */ }
      });
      return _open.call(this, m, u, ...rest);
    };
    console.log('%c[hasta] espião de API ligado — navegue até um lote para ver os endpoints', 'color:#0891b2');
  }

  // ── 2) Colheita: lotes da home → iframe oculto → texto renderizado + PDFs ──
  const links = [...new Set([...document.querySelectorAll('a[href*="/lote/"]')]
    .map((a) => a.href).filter((h) => /\/lote\/\d+\//.test(h)))].slice(0, MAX_LOTES);
  console.log(`[hasta] ${links.length} lote(s) na home. Colhendo (~${Math.round(links.length * (ESPERA_MS + 1500) / 1000)}s)…`);

  const out = { colhido_em: new Date().toISOString(), origem: location.href, lotes: [] };
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;width:1280px;height:2000px';
  document.body.appendChild(iframe);

  for (const [i, url] of links.entries()) {
    try {
      await new Promise((ok, erro) => {
        const t = setTimeout(() => erro(new Error('timeout')), 30000);
        iframe.onload = () => { clearTimeout(t); ok(); };
        iframe.src = url;
      });
      await new Promise((r) => setTimeout(r, ESPERA_MS));   // hidratação da SPA
      const doc = iframe.contentDocument;
      out.lotes.push({
        url,
        texto: (doc.body.innerText || '').replace(/\s+/g, ' ').slice(0, 20000),
        pdfs: [...new Set([...doc.querySelectorAll('a[href*=".pdf"]')].map((a) => a.href))],
        fotos: [...new Set([...doc.querySelectorAll('img[src*="hasta"], img[src*="lote"], img[src*="bem"]')].map((m) => m.src))].slice(0, 3),
      });
      console.log(`  ${i + 1}/${links.length} ok — ${url.slice(-60)}`);
    } catch (e) {
      out.lotes.push({ url, erro: String(e.message || e) });
      console.warn(`  ${i + 1}/${links.length} FALHOU — ${url.slice(-60)}: ${e.message}`);
    }
  }
  iframe.remove();

  const json = JSON.stringify(out, null, 1);
  try { await navigator.clipboard.writeText(json); console.log('%c[hasta] COLHEITA CONCLUÍDA — JSON copiado para a área de transferência.', 'color:#16a34a;font-weight:bold'); }
  // `copy()` só existe no console do DevTools — por isso via globalThis (e o eslint node não o conhece).
  catch { try { globalThis.copy(out); console.log('%c[hasta] COLHEITA CONCLUÍDA — use o copy() do DevTools (já chamado).', 'color:#16a34a'); } catch { console.log(json); } }
  window.__hastaDump = out;   // também fica em window.__hastaDump
  return `${out.lotes.filter((l) => !l.erro).length}/${links.length} lotes colhidos`;
})();
