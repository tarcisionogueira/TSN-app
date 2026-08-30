/**
 * GET /api/meta-insights-cron — puxa da META INSIGHTS API (leitura) o gasto/cliques/
 * impressões DIÁRIOS por campanha dos últimos 7 dias e grava em marketing_metricas_dia
 * (upsert → reexecuções corrigem retroativamente). Alimenta o painel Marketing (CAC/ROAS
 * automáticos do canal Meta Ads).
 *
 * DORMENTE até existirem META_ADS_TOKEN (token com ads_read do Business) e
 * META_AD_ACCOUNT_ID (ex.: act_1114056112873901). Guard: x-cron-secret (padrão dos crons).
 * Somente LEITURA no Meta — este token não gerencia campanhas nem gasta orçamento.
 */
// Sem `config`, herdava o default da Vercel — e este cron faz várias chamadas à Graph API
// em série (7 dias × campanhas) antes de gravar. Cortado no meio, ele grava METADE do
// período e devolve sucesso: o painel de CAC/ROAS mostra número menor sem nada indicar
// que faltou dado. Marketing errado para baixo é pior que marketing ausente. (11/08)
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import { isCronAuthorized } from './_auth.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const API_VER = (process.env.META_GRAPH_VERSION || 'v21.0').trim();

// ── CONVERSÃO NO META NÃO É UM CAMPO, É UM ARRAY (29/08) ──────────────────────────────
// Até hoje este cron pedia só `spend,clicks,impressions` e gravava `conversoes: null`
// literalmente — então 100% das linhas do Meta saíam nulas, e o painel de CAC/ROAS ficava
// sem denominador com a verba rodando. Forma nº 8 do CLAUDE.md: o que não é PEDIDO nunca
// chega para ser ignorado.
//
// O retorno traz `actions: [{action_type, value}]`, e as famílias SE SOBREPÕEM: `purchase`
// e `offsite_conversion.fb_pixel_purchase` contam a MESMA venda. Somar tudo dobra o número.
// Por isso cada família soma **o primeiro action_type presente**, na ordem abaixo (o
// agregado primeiro, o específico do pixel como reserva) — e nunca dois da mesma família.
//
// As duas famílias são exatamente os eventos que NÓS mandamos pela CAPI (`_meta-capi.js`):
// `Lead` (inscrição na live) e `Purchase` (webhook de pagamento). Ler de volta outra coisa
// mediria uma campanha que não é a nossa.
const FAMILIAS_CONVERSAO = [
  { nome: 'lead',     tipos: ['lead', 'offsite_conversion.fb_pixel_lead'] },
  { nome: 'purchase', tipos: ['purchase', 'offsite_conversion.fb_pixel_purchase'] },
];

/**
 * Soma as conversões de uma linha de insight e devolve TAMBÉM a evidência do que foi lido.
 * A evidência não é luxo: sem o `META_ADS_TOKEN` não dá para rodar em seco contra a conta
 * real, então o mapeamento precisa ser conferível contra o Gerenciador de Anúncios DEPOIS
 * da primeira execução. Mapeamento errado dá número plausível — a forma nº 10 — e sem
 * `por_tipo` gravado ele seria invisível.
 */
export function apurarConversoes(actions) {
  // `actions` ausente com o campo PEDIDO = não houve ação no período: zero de verdade.
  // (Antes o nulo dizia "não perguntei"; agora nulo só sobra se a apuração não rodar.)
  if (!Array.isArray(actions)) {
    return { total: 0, detalhe: { por_tipo: {}, usados: {}, nota: 'sem actions no retorno' } };
  }
  const porTipo = {};
  for (const a of actions) {
    const t = String(a?.action_type || '').trim();
    if (!t) continue;
    porTipo[t] = (porTipo[t] || 0) + (Number(a?.value) || 0);
  }
  const usados = {};
  let total = 0;
  for (const fam of FAMILIAS_CONVERSAO) {
    const escolhido = fam.tipos.find(t => porTipo[t] != null);
    if (!escolhido) continue;
    usados[escolhido] = porTipo[escolhido];
    total += porTipo[escolhido];
  }
  return { total, detalhe: { por_tipo: porTipo, usados } };
}

export default async function handler(req, res) {
  // 19/08: era o ÚNICO cron fora do `isCronAuthorized` — e aceitava a mera PRESENÇA do
  // header `x-vercel-cron` (que qualquer chamador escreve) como credencial. De quebra, a
  // comparação media length em CARACTERES e o timingSafeEqual em BYTES: um header multibyte
  // do tamanho "certo" dava RangeError → 500 em vez de 401. Política única de api/_auth.js.
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'nao_autorizado' });

  const token = (process.env.META_ADS_TOKEN || '').trim();
  let conta = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!token || !conta) return res.status(200).json({ skipped: 'dormente', dica: 'Defina META_ADS_TOKEN e META_AD_ACCOUNT_ID no Vercel.' });
  if (!conta.startsWith('act_')) conta = `act_${conta}`;

  // JANELA CONFIGURÁVEL (30/08) — antes eram 7 dias FIXOS, sem forma de pedir outra coisa.
  // O efeito: `marketing_metricas_dia` "começa" no dia em que o cron entrou no ar (24/08 para o
  // Meta), e todo o histórico da conta fica invisível ao painel do BidPro. Medido em 30/08: a
  // conta tinha ~R$ 5.500 e ~25 mil cliques desde outubro/2025 — incluindo tráfego a R$ 0,12 e
  // R$ 0,17 por clique — enquanto o painel mostrava R$ 40 de Meta e dava a entender que o canal
  // era irrelevante. A comparação que importa (o Google Ads custa R$ 0,57/clique, 3 a 5× mais)
  // era impossível de fazer pela tela.
  //
  // `?desde=AAAA-MM-DD` e `?ate=AAAA-MM-DD` permitem a carga retroativa; sem eles, o
  // comportamento diário de sempre (7 dias). Teto de 400 dias porque o upsert é por
  // (data, canal, campanha) e uma janela absurda só multiplica páginas sem trazer dado novo.
  const q = (k) => {
    const v = req.query?.[k];
    const s2 = String(Array.isArray(v) ? v[0] : (v || '')).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s2) ? s2 : null;
  };
  const fmt = (d) => d.toISOString().slice(0, 10);
  const qAte = q('ate'); const qDesde = q('desde');
  const ate = qAte ? new Date(`${qAte}T12:00:00Z`) : new Date();
  let desde = qDesde ? new Date(`${qDesde}T12:00:00Z`) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const TETO_DIAS = 400;
  if ((ate - desde) / 86400000 > TETO_DIAS) desde = new Date(ate.getTime() - TETO_DIAS * 86400000);
  // Carga retroativa gera MUITO mais linha que a diária (1 linha por campanha por dia), então o
  // teto de páginas acompanha a janela — senão o backfill sai com `ok:true` e metade do período,
  // que é o defeito de paginação já corrigido aqui em 19/08 voltando pela porta da janela.
  const maxPaginas = qDesde ? 60 : 10;

  try {
    // 19/08: `limit=200` sem seguir `paging.next` — 7 dias × campanhas passa de 200 e o
    // restante sumia com `ok:true, gravadas:N`. Segue a paginação (teto de 10 páginas).
    let url = `https://graph.facebook.com/${API_VER}/${encodeURIComponent(conta)}/insights` +
      `?level=campaign&time_increment=1` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since: fmt(desde), until: fmt(ate) }))}` +
      `&fields=campaign_name,spend,clicks,impressions,actions&limit=200` +
      `&access_token=${encodeURIComponent(token)}`;
    const dados = [];
    for (let pagina = 0; pagina < maxPaginas && url; pagina++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('[meta-insights] HTTP', r.status, JSON.stringify(body?.error || body).slice(0, 300));
        return res.status(502).json({ error: 'meta_api', http: r.status, detalhe: body?.error?.message || null });
      }
      dados.push(...(body?.data || []));
      url = body?.paging?.next || null;
    }
    const rows = dados.map(d => {
      const conv = apurarConversoes(d.actions);
      return {
        data: d.date_start,
        canal: 'Meta Ads',
        campanha: String(d.campaign_name || '').slice(0, 120),
        gasto: Math.max(0, Number(d.spend) || 0),
        cliques: Math.max(0, Math.trunc(Number(d.clicks) || 0)),
        impressoes: Math.max(0, Math.trunc(Number(d.impressions) || 0)),
        conversoes: conv.total,
        conversoes_detalhe: conv.detalhe,
        atualizado_em: new Date().toISOString(),
      };
    }).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x.data || '')));

    // Os action_type DISTINTOS que a conta devolveu, no log da execução. É a primeira coisa
    // a olhar se o total divergir do Gerenciador: revela família que não está na lista
    // (`onsite_conversion.*`, `omni_purchase`, evento personalizado) sem precisar de outra
    // investigação. Contador agregado descreveria o sintoma e esconderia a causa.
    const tiposVistos = [...new Set(rows.flatMap(r => Object.keys(r.conversoes_detalhe?.por_tipo || {})))];
    console.log(`[meta-insights] ${rows.length} linha(s) · action_types vistos: ${tiposVistos.join(', ') || '(nenhum)'}`);

    if (rows.length) {
      const { error } = await supabase.from('marketing_metricas_dia')
        .upsert(rows, { onConflict: 'data,canal,campanha' });
      if (error) throw new Error(error.message);
    }
    return res.status(200).json({
      ok: true, gravadas: rows.length,
      conversoes: rows.reduce((a, r) => a + (r.conversoes || 0), 0),
      action_types_vistos: tiposVistos,
    });
  } catch (e) {
    console.error('[meta-insights]', e?.message || e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
