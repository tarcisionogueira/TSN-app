/**
 * /api/regenerar-relatorios-cron — REGERAÇÃO POR VÍCIO (loop de aprendizado).
 *
 * Executa o "apontamento para regerar": quando um relatório saiu com VÍCIO regenerável
 * (regen_motivo != null — matrícula não lida, CNJ não consultado, contradição/revisão no
 * laudo…), dispara um NOVO ciclo de geração com orçamento fresco. Se a causa-raiz foi
 * resolvida (doc capturado, valor confirmado), o gerador re-emite SEM o vício e o flag
 * some. Se persistir, regen_tentativas sobe até o teto e para (economia: não regera
 * infinito um vício permanente, ex.: matrícula que não existe).
 *
 * SEGURO: server-side, fire-and-forget, best-effort — nunca toca o fluxo vivo do usuário
 * (o gerador é chamado por CRON_SECRET, sem cota, e re-emite o relatório existente; um
 * 'gerando' preso >15min é destravado pelo limpar-analises-cron). ECONÔMICO: teto de
 * tentativas + lote pequeno + janela de assentamento + corte de 72h + roda a cada 6h.
 *
 * Escopo: documental e laudo (vícios regeneráveis por regen_motivo) + MERCADO que falhou por
 * TIMEOUT (transitório) — este é re-tentado UMA vez com orçamento fresco (self-heal), para o
 * cliente não ficar com um 'erro' preso sem reagir + MERCADO que CONCLUIU com PARECER EM BRANCO
 * e mercado NÃO-vazio (o valorMercado veio, mas a redação do parecer falhou silenciosamente —
 * bug do erro de API engolido; o cliente vê "relatório" sem o parecer). Os vícios de valor do
 * mercado (avaliação/mínimo ausentes) seguem se auto-corrigindo no garantirValores a cada geração.
 * Autorizado por CRON_SECRET (Bearer). Registrado no vercel.json.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
// Domínio canônico (www): o apex redireciona 308 — igual ao documental-retry-cron.
const BASE = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace('://bidprobrasil.com.br', '://www.bidprobrasil.com.br');

const MAX_TENT = 3;   // teto de regeração por relatório (economia)
const LOTE = 2;       // por tipo, por run (cada um abre 1 chamada de IA longa)
const SETTLE_H = 2;   // espera o dado assentar (captura de doc/valor) antes de gastar IA
const JANELA_H = 72;  // não regera relatório mais velho que isto

const AGENTES = [
  { tabela: 'analises_documental', endpoint: 'gerar-documental' },
  { tabela: 'analises_laudo',      endpoint: 'gerar-laudo-viabilidade' },
];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) { res.status(500).json({ error: 'env ausente' }); return; }

  const agora = Date.now();
  const settle = new Date(agora - SETTLE_H * 3600 * 1000).toISOString();
  const janela = new Date(agora - JANELA_H * 3600 * 1000).toISOString();
  const out = {};

  for (const { tabela, endpoint } of AGENTES) {
    let rows = [];
    try {
      const q = `${tabela}?status=eq.concluida&regen_motivo=not.is.null&regen_tentativas=lt.${MAX_TENT}`
        + `&updated_at=lt.${encodeURIComponent(settle)}&updated_at=gt.${encodeURIComponent(janela)}`
        + `&order=updated_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado,regen_tentativas`;
      rows = await (await sb(q)).json();
    } catch { rows = []; }
    if (!Array.isArray(rows) || !rows.length) { out[tabela] = 0; continue; }

    await Promise.allSettled(rows.map(async (r) => {
      // Incrementa a tentativa ANTES de disparar (mesmo se a geração falhar, conta —
      // evita loop). O gerador, ao re-emitir, limpa regen_motivo se o vício sumiu.
      try {
        await sb(`${tabela}?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
        });
      } catch { /* segue mesmo assim */ }
      await fetch(`${BASE}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
        body: JSON.stringify({ imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado }),
        signal: AbortSignal.timeout(9000),
      }).catch(() => {});
    }));
    out[tabela] = rows.length;
  }

  // SELF-HEAL do MERCADO: relatório que falhou por TIMEOUT (transitório) é re-tentado com orçamento
  // fresco. QUALIDADE em 1º lugar (decisão do dono): persiste até 4 tentativas (a cada 6h ≈ 24h) —
  // antes parava após 1 e o cliente ficava com "erro" preso. Cada tentativa é mais assertiva
  // (pause_turn cap 8 + salvamento + índice semeando). Relê mercadoInputs do `inputs` da linha.
  let mktRetry = 0;
  try {
    const q = `analises_mercado?status=eq.erro&erro=ilike.*tempo*limite*&regen_tentativas=lt.4`
      + `&updated_at=lt.${encodeURIComponent(settle)}&updated_at=gt.${encodeURIComponent(janela)}`
      + `&order=updated_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado,imovel,inputs,regen_tentativas`;
    const rows = await (await sb(q)).json();
    if (Array.isArray(rows)) {
      await Promise.allSettled(rows.map(async (r) => {
        if (!r?.inputs?.mercadoInputs) return; // sem os inputs originais não dá p/ regerar
        try {
          await sb(`analises_mercado?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
          });
        } catch { /* segue mesmo assim */ }
        await fetch(`${BASE}/api/gerar-analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
          body: JSON.stringify({
            imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
            imovel: r.imovel || null, mercadoInputs: r.inputs.mercadoInputs, parecerInputs: r.inputs.parecerInputs,
          }),
          signal: AbortSignal.timeout(9000),
        }).catch(() => {});
        mktRetry++;
      }));
    }
  } catch { /* self-heal best-effort: nunca derruba o cron */ }
  out.analises_mercado_timeout = mktRetry;

  // SELF-HEAL do MERCADO VAZIO: relatório que CONCLUIU mas voltou SEM amostras (fonte de
  // pesquisa instável no momento — 0 vendas/locações e sem preço) NÃO cobra cota do cliente
  // e é re-tentado em background com orçamento fresco, até 48h após criado (janela pela IDADE
  // do relatório — created_at não desliza no upsert). Teto de tentativas p/ não gastar IA
  // eternamente num mercado GENUINAMENTE raso (imóvel atípico sem comparáveis): passado o teto,
  // fica como "não estimado" (estado final correto). Ao PREENCHER, o flag some e para sozinho.
  let mktVazio = 0;
  const MAX_VAZIO = 4;                 // BALANÇO qualidade × economia (novo pedido do dono): re-gera em
                                       // background (a cada 6h) por ~24h — alinhado ao TETO de 24h que o
                                       // dono definiu — até entregar com amostras. Antes eram 6 (~36h),
                                       // o que re-gastava busca web à toa em praça genuinamente rasa.
                                       // Cada tentativa é mais assertiva (pause_turn cap 8 + salvamento
                                       // + índice semeando), então converge sem desperdício; ao
                                       // preencher, o flag some e para sozinho.
  const idade48 = new Date(agora - 48 * 3600 * 1000).toISOString();
  try {
    const q = `analises_mercado?status=eq.concluida&result->>mercadoVazio=eq.true&regen_tentativas=lt.${MAX_VAZIO}`
      + `&created_at=gt.${encodeURIComponent(idade48)}`
      + `&order=updated_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado,imovel,inputs,regen_tentativas`;
    const rows = await (await sb(q)).json();
    if (Array.isArray(rows)) {
      await Promise.allSettled(rows.map(async (r) => {
        if (!r?.inputs?.mercadoInputs) return; // sem os inputs originais não dá p/ regerar
        try {
          await sb(`analises_mercado?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
          });
        } catch { /* segue mesmo assim */ }
        await fetch(`${BASE}/api/gerar-analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
          body: JSON.stringify({
            imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
            imovel: r.imovel || null, mercadoInputs: r.inputs.mercadoInputs, parecerInputs: r.inputs.parecerInputs,
          }),
          signal: AbortSignal.timeout(9000),
        }).catch(() => {});
        mktVazio++;
      }));
    }
  } catch { /* self-heal best-effort: nunca derruba o cron */ }
  out.analises_mercado_vazio = mktVazio;

  // SELF-HEAL do PARECER VAZIO: relatório que CONCLUIU com valorMercado (mercado NÃO-vazio) mas
  // com o PARECER em branco — assinatura do bug do erro de API silenciado na REDAÇÃO do parecer
  // (a busca de mercado deu certo; a chamada de texto falhou sem lançar → parecer ''). O cliente
  // fica com um "relatório" concluído sem o parecer. O branch de mercadoVazio NÃO pega (aqui
  // mercadoVazio != true). Regenera do snapshot gravado (inputs.mercadoInputs), SEM cobrar cota
  // (isCron). SEM janela de idade — o predicado se auto-limpa: ao preencher o parecer o relatório
  // sai do filtro; se não der para regerar (sem inputs) bate o teto e para (economia).
  let mktParecer = 0;
  // 4 tentativas ESPAÇADAS (não 2): em 29/07 a API da Anthropic passou a madrugada instável
  // (529/abort) e as 2 tentativas caíram DENTRO da mesma janela ruim → 4 relatórios presos
  // sem parecer até intervenção manual. A regeração do parecer é barata (reusa a pesquisa
  // de mercado recente), então o teto sobe e cada tentativa exige ≥5h desde a anterior —
  // garantindo que as 4 caiam em janelas distintas de saúde da API.
  const MAX_PARECER = 4;
  const ESPACO_PARECER_H = 5;
  const espacoParecer = new Date(agora - ESPACO_PARECER_H * 3600 * 1000).toISOString();
  // Lote MAIOR que os demais: a regeração do parecer REUSA a pesquisa de mercado recente
  // (mercadoRecente/reaproveitado) — não repaga web search — então é BARATA e pode limpar o
  // backlog de "parecer em branco" num só run em vez de arrastar por vários ciclos.
  const LOTE_PARECER = 8;
  try {
    const q = `analises_mercado?status=eq.concluida&result->>parecer=eq.&regen_tentativas=lt.${MAX_PARECER}`
      + `&or=(regen_em.is.null,regen_em.lt.${encodeURIComponent(espacoParecer)})`
      + `&order=updated_at.asc&limit=${LOTE_PARECER}&select=user_id,imovel_id,titulo,cidade,estado,imovel,inputs,result,regen_tentativas,cota_estornada`;
    const rows = await (await sb(q)).json();
    if (Array.isArray(rows)) {
      await Promise.allSettled(rows.map(async (r) => {
        if (!r?.inputs?.mercadoInputs) return;          // sem inputs originais não dá p/ regerar
        if (r?.result?.mercadoVazio === true) return;   // mercado genuinamente vazio: outro branch
        if ((r?.result?.parecer || '').trim().length >= 200) return; // guarda: só parecer em branco
        // ESTORNO DA COTA (regra do dono: relatório que não funcionou bem devolve a cota). 1x por
        // relatório (cota_estornada). estornar_analise_por('mensal') é NO-OP p/ quem não foi cobrado
        // (count 0 ou mês diferente) → seguro chamar sem checar papel. Não bloqueia a regeração.
        if (!r.cota_estornada) {
          try {
            await sb(`rpc/estornar_analise_por`, { method: 'POST', body: JSON.stringify({ p_user_id: r.user_id, p_tipo: 'mensal' }) });
            await sb(`analises_mercado?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
              method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ cota_estornada: true }) });
          } catch { /* estorno best-effort */ }
        }
        try {
          await sb(`analises_mercado?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
          });
        } catch { /* segue mesmo assim */ }
        await fetch(`${BASE}/api/gerar-analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
          body: JSON.stringify({
            imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
            imovel: r.imovel || null, mercadoInputs: r.inputs.mercadoInputs, parecerInputs: r.inputs.parecerInputs,
          }),
          signal: AbortSignal.timeout(9000),
        }).catch(() => {});
        mktParecer++;
      }));
    }
  } catch { /* self-heal best-effort: nunca derruba o cron */ }
  out.analises_mercado_parecer_vazio = mktParecer;

  res.status(200).json({ ok: true, regenerados: out });
}
