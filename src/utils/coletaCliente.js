// Coleta CLIENT-SIDE dos leiloeiros Vlance a partir do IP REAL do STAFF (economiza Bright Data).
// A API do Vlance tem CORS aberto → o navegador do staff chama get-leiloes/get-lotes direto e
// manda os lotes CRUS para /api/coleta-cliente, que valida e grava (fonte VLANCE). O gate no
// servidor garante ~2x/semana e 1 disparo por janela. Silencioso: nunca atrapalha o usuário.
import { apiCall } from './apiCall';

const SESSAO_KEY = 'bidpro_coleta_cliente_v1';
const MAX_PAGINAS = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonFetch(url, opts, tentativas = 2) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, opts);           // cross-origin: só CORS-safe (sem headers extras)
      if (r.ok) return await r.json();
    } catch { /* rede/CORS bloqueado → tenta de novo / desiste */ }
    await sleep(700);
  }
  return null;
}

async function coletarTenant(dom) {
  const base = `https://www.${dom.replace(/^www\./, '')}`;
  let alcancado = false;
  const evResp = await jsonFetch(`${base}/core/api/get-leiloes`);
  if (evResp) alcancado = true;
  const leiloes = {};
  for (const ev of (evResp?.items || [])) { const id = ev?.id ?? ev?.leilao_id; if (id != null) leiloes[String(id)] = ev; }

  const lotes = [];
  let page = 1;
  while (page <= MAX_PAGINAS) {
    // POST form-urlencoded = requisição "simples" (sem preflight CORS).
    const d = await jsonFetch(`${base}/core/api/get-lotes`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `page=${page}`,
    });
    if (!d) break;
    alcancado = true;
    for (const l of (d.items || [])) lotes.push(l);
    const atual = Number(d.currentPage || page), total = Number(d.totalPages || atual);
    if (atual >= total || !d.nextPage) break;
    page = atual + 1;
    await sleep(500);
  }
  return { dominio: dom.replace(/^www\./, ''), lotes, leiloes, alcancado };
}

/**
 * Dispara a coleta (só STAFF, 1x por sessão). Chama o gate; se estiver na hora, coleta do IP do
 * staff e envia. Só envia se ALCANÇOU ao menos um site (evita fechar o gate por falha de rede).
 */
let emAndamento = false; // trava em memória: evita 2 disparos concorrentes (ex.: AuthContext + MainLayout)

export async function dispararColetaClienteStaff() {
  try {
    if (emAndamento) return;                                   // já rodando neste load → não duplica
    try { if (sessionStorage.getItem(SESSAO_KEY)) return; } catch { /* */ }
    emAndamento = true;

    const chk = await apiCall('/api/coleta-cliente', { method: 'GET' });
    if (!chk.ok) return;
    const cfg = await chk.json().catch(() => null);
    if (!cfg?.devida || !Array.isArray(cfg.tenants)) {
      try { sessionStorage.setItem(SESSAO_KEY, '1'); } catch { /* */ } // não é a hora/staff → não re-checa nesta sessão
      return;
    }

    const coletas = [];
    for (const dom of cfg.tenants) coletas.push(await coletarTenant(dom));
    // Não alcançou nenhum site → NÃO marca a sessão: assim um novo login/reabertura reTENTA
    // (o gate 2x/semana do servidor segue protegendo contra excesso).
    if (!coletas.some((c) => c.alcancado)) return;

    await apiCall('/api/coleta-cliente', {
      method: 'POST',
      body: JSON.stringify({ coletas: coletas.map(({ dominio, lotes, leiloes }) => ({ dominio, lotes, leiloes })) }),
    });
    try { sessionStorage.setItem(SESSAO_KEY, '1'); } catch { /* */ } // concluiu (mesmo com 0 gravados) → marca a sessão
  } catch { /* nunca atrapalha o usuário */ }
  finally { emAndamento = false; }
}
