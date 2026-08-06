export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// Painel "Custos & Uso das Integrações" do dashboard admin. Agrega uso_integracoes
// (hoje + mês corrente) por provedor e aplica tetos/limiares para marcadores
// verde/amarelo/vermelho — para não haver surpresa ao cruzar o teto gratuito
// (Gemini) ou o orçamento (Claude e demais serviços pagos).
//
// Tetos configuráveis por env (defaults conservadores):
//   GEMINI_FREE_RPD          teto grátis de requisições/dia do Gemini (default 250)
//   GEMINI_BUDGET_USD_MES    orçamento mensal alvo do Gemini em USD (default 20)
//   CLAUDE_BUDGET_USD_MES    orçamento mensal alvo do Claude em USD (default 50)
//   BRIGHTDATA_MAX_REQ_SEMANA teto semanal Bright Data (default 450)
//   APP_USD_BRL              câmbio p/ exibir em R$ (default 5.4)

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

function status(pct) { return pct >= 100 ? 'vermelho' : pct >= 70 ? 'amarelo' : 'verde'; }

export default async function handler(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const usdBrl = num(process.env.APP_USD_BRL, 5.4);
  const geminiRpd = num(process.env.GEMINI_FREE_RPD, 250);
  const geminiBudget = num(process.env.GEMINI_BUDGET_USD_MES, 20);
  const claudeBudget = num(process.env.CLAUDE_BUDGET_USD_MES, 50);
  const bdTeto = num(process.env.BRIGHTDATA_MAX_REQ_SEMANA, 450);
  // Sustentabilidade: quanto 1 Investidor Pro banca de consultas grátis do Explorador.
  const precoPro = num(process.env.PRECO_PRO_BRL, 49.90);           // receita/mês de 1 Pro
  const fracaoSubsidio = num(process.env.IA_FRACAO_SUBSIDIO, 0.45); // % da receita do Pro alocada à IA grátis
  const custoAnaliseUsd = num(process.env.IA_CUSTO_ANALISE_USD, 0.49); // custo medido no piloto (Claude mercadológica)

  // Datas (UTC) — mesmo bucket usado pelo registrar_uso.
  const hoje = new Date().toISOString().slice(0, 10);
  const inicioMes = hoje.slice(0, 8) + '01';

  // Agrega linhas do mês em memória (volume pequeno).
  const acc = {}; // chave provedor → { hoje:{req,ti,to,uni,usd}, mes:{...} }
  const bump = (b, r) => { b.req += r.requests || 0; b.ti += r.tokens_in || 0; b.to += r.tokens_out || 0; b.uni += Number(r.unidades) || 0; b.usd += (r.custo_usd_micro || 0) / 1e6; };
  const novo = () => ({ req: 0, ti: 0, to: 0, uni: 0, usd: 0 });

  try {
    if (SB && KEY) {
      const r = await fetch(`${SB}/rest/v1/uso_integracoes?dia=gte.${inicioMes}&select=provedor,operacao,dia,requests,tokens_in,tokens_out,unidades,custo_usd_micro`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (r.ok) {
        const rows = await r.json();
        for (const row of rows) {
          const p = row.provedor || 'outro';
          if (!acc[p]) acc[p] = { hoje: novo(), mes: novo() };
          bump(acc[p].mes, row);
          if (row.dia === hoje) bump(acc[p].hoje, row);
        }
      }
    }
  } catch { /* painel degrada para zeros se falhar */ }

  const get = (p) => acc[p] || { hoje: novo(), mes: novo() };
  const brl = (usd) => Math.round(usd * usdBrl * 100) / 100;

  const gem = get('gemini');
  const cla = get('claude');
  const res = get('resend');
  const daily = get('daily');
  const geo = get('locationiq');
  const ggeo = get('google_geocode');
  const geoFreeMes = num(process.env.GOOGLE_GEOCODE_FREE_MES, 10000);

  const provedores = [];

  // GEMINI — marcador de teto GRÁTIS diário (requisições/dia) + custo do mês.
  {
    const pct = geminiRpd > 0 ? Math.round((gem.hoje.req / geminiRpd) * 100) : 0;
    provedores.push({
      chave: 'gemini', label: 'Gemini — IA de chat, tickets e pesquisa',
      hoje: { requests: gem.hoje.req, tokens: gem.hoje.ti + gem.hoje.to, custo_usd: gem.hoje.usd, custo_brl: brl(gem.hoje.usd) },
      mes: { requests: gem.mes.req, tokens: gem.mes.ti + gem.mes.to, custo_usd: gem.mes.usd, custo_brl: brl(gem.mes.usd) },
      teto: { tipo: 'requisicoes_dia', limite: geminiRpd, usado: gem.hoje.req, pct, status: status(pct),
        nota: `Grátis até ~${geminiRpd} req/dia. Acima disso passa a cobrar (crédito pré-pago).` },
      orcamento_mes: { limite_usd: geminiBudget, usado_usd: gem.mes.usd, pct: geminiBudget > 0 ? Math.round((gem.mes.usd / geminiBudget) * 100) : 0 },
    });
  }

  // CLAUDE — marcador de ORÇAMENTO mensal (USD estimado) + buscas web metradas.
  {
    const pct = claudeBudget > 0 ? Math.round((cla.mes.usd / claudeBudget) * 100) : 0;
    provedores.push({
      chave: 'claude', label: 'Claude — IA jurídica, documental e contratos',
      hoje: { requests: cla.hoje.req, tokens: cla.hoje.ti + cla.hoje.to, custo_usd: cla.hoje.usd, custo_brl: brl(cla.hoje.usd) },
      mes: { requests: cla.mes.req, tokens: cla.mes.ti + cla.mes.to, custo_usd: cla.mes.usd, custo_brl: brl(cla.mes.usd), buscas_web: cla.mes.uni },
      teto: { tipo: 'orcamento_mes_usd', limite: claudeBudget, usado: cla.mes.usd, pct, status: status(pct),
        nota: `Orçamento mensal alvo US$ ${claudeBudget}. Inclui buscas web (US$ 10/1.000).` },
    });
  }

  // BRIGHT DATA — teto SEMANAL (fonte: brightdata_uso, já existente).
  try {
    if (SB && KEY) {
      const r = await fetch(`${SB}/rest/v1/brightdata_uso?select=semana,requests&order=semana.desc&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (r.ok) {
        const [row] = await r.json();
        const usados = row?.requests || 0;
        const pct = bdTeto > 0 ? Math.round((usados / bdTeto) * 100) : 0;
        provedores.push({
          chave: 'brightdata', label: 'Bright Data — desbloqueio de scraping',
          semana: row?.semana || null,
          teto: { tipo: 'requisicoes_semana', limite: bdTeto, usado: usados, pct, status: status(pct),
            nota: 'Teto semanal rígido (fail-safe de custo já ativo no scraper).' },
        });
      }
    }
  } catch { /* opcional */ }

  // GOOGLE GEOCODE — marcador de teto GRÁTIS mensal (10k/mês) + custo além.
  {
    const usados = ggeo.mes.uni;
    const pct = geoFreeMes > 0 ? Math.round((usados / geoFreeMes) * 100) : 0;
    const excedente = Math.max(0, usados - geoFreeMes);
    const custoUsd = excedente * 0.005; // US$ 5 / 1.000 além da cota grátis
    provedores.push({
      chave: 'google_geocode', label: 'Google Geocoding — coordenadas dos imóveis',
      mes: { unidades: usados, custo_usd: custoUsd, custo_brl: brl(custoUsd) },
      teto: { tipo: 'geocodes_mes', limite: geoFreeMes, usado: usados, pct, status: status(pct),
        nota: `Grátis até ${geoFreeMes.toLocaleString('pt-BR')}/mês (renova todo mês). Acima: US$ 5/1.000.` },
    });
  }

  // RESEND — teto GRÁTIS mensal (~3.000). Cobertura parcial (só envios via _email.js).
  {
    const resFree = num(process.env.RESEND_FREE_MES, 3000);
    const pct = resFree > 0 ? Math.round((res.mes.uni / resFree) * 100) : 0;
    provedores.push({ chave: 'resend', label: 'Resend — e-mails transacionais',
      mes: { unidades: res.mes.uni, custo_usd: res.mes.usd, custo_brl: brl(res.mes.usd) },
      teto: { tipo: 'emails_mes', limite: resFree, usado: res.mes.uni, pct, status: status(pct),
        nota: `Grátis até ~${resFree.toLocaleString('pt-BR')}/mês. Contagem parcial (envios centrais).` } });
  }

  // DAILY / LOCATIONIQ — volume (sem teto rígido; marcador informativo).
  provedores.push({ chave: 'daily', label: 'Daily.co — salas de vídeo',
    mes: { unidades: daily.mes.uni, custo_usd: daily.mes.usd, custo_brl: brl(daily.mes.usd) },
    teto: { tipo: 'volume', nota: 'Cobrança por minuto-participante. Marcador informativo.' } });
  provedores.push({ chave: 'locationiq', label: 'LocationIQ — geocoder pago (opcional)',
    mes: { unidades: geo.mes.uni, custo_usd: geo.mes.usd, custo_brl: brl(geo.mes.usd) },
    teto: { tipo: 'volume', nota: 'Só ativa se GEOCODER_KEY definido; senão usa Nominatim (grátis).' } });

  const totalMesUsd = provedores.reduce((s, p) => s + (p.mes?.custo_usd || 0), 0);

  // ── PROJEÇÃO FIM DE MÊS (run-rate) — cada indicador aprende a trajetória do
  // fluxo real: projeta o mês inteiro a partir do ritmo dos dias já decorridos.
  const now = new Date();
  const diaDoMes = now.getUTCDate();
  const diasNoMes = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const fatorProj = diasNoMes / Math.max(1, diaDoMes);
  provedores.forEach((p) => {
    if (!p.mes) return;
    if (p.mes.custo_usd != null) p.mes.projecao_custo_usd = Math.round(p.mes.custo_usd * fatorProj * 100) / 100;
    if (p.mes.custo_brl != null) p.mes.projecao_custo_brl = Math.round(p.mes.custo_brl * fatorProj * 100) / 100;
    if (p.mes.unidades != null) p.mes.projecao_unidades = Math.round(p.mes.unidades * fatorProj);
    if (p.teto && typeof p.teto.limite === 'number' && p.teto.limite > 0 && p.teto.usado != null) {
      p.teto.projecao = Math.round(p.teto.usado * fatorProj);
      p.teto.pct_projecao = Math.round((p.teto.projecao / p.teto.limite) * 100);
    }
  });
  const projecaoTotalUsd = totalMesUsd * fatorProj;

  // ── SUSTENTABILIDADE: 1 Investidor Pro banca N consultas grátis do Explorador ──
  // Marco por quantidade de usuários: com N Pros, o teto sustentável de análises
  // grátis/mês é N × (quanto 1 Pro subsidia). Se o consumo grátis passar disso, o
  // grátis está deficitário (marcador vermelho).
  let sustentabilidade = null;
  try {
    let m = { n_investidor_pro: 0, n_explorador: 0, analises_explorador_mes: 0, analises_total_mes: 0 };
    if (SB && KEY) {
      const r = await fetch(`${SB}/rest/v1/rpc/sustentabilidade_ia`, {
        method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: '{}',
      });
      if (r.ok) m = await r.json();
    }

    // Custo/análise APRENDIDO — agora do custo REAL de cada geração (`geracao_custos`,
    // uma linha por relatório), não mais de `claude/web_search`.
    //
    // Por que mudou: a métrica antiga assumia "1 mercadológica = 1 chamada claude
    // web_search". Isso deixou de ser verdade quando o mercadológico migrou para o Gemini
    // grounding — desde então o único consumidor de claude/web_search é o ÍNDICE, então o
    // painel vinha medindo o custo do ÍNDICE e chamando de "custo por análise". Como o
    // índice custa cerca de 4x o relatório, o teto de "análises grátis que um Pro banca"
    // saía subestimado por um fator próximo de 4.
    //
    // Fallback preservado: sem linhas suficientes em geracao_custos (base nova), cai no
    // seed do piloto A/B, como antes — nunca fica sem número.
    let custoAprendidoUsd = custoAnaliseUsd, baseAmostras = 0, aprendido = false;
    try {
      if (SB && KEY) {
        const r = await fetch(`${SB}/rest/v1/geracao_custos?funcao=eq.mercadologico&ok=is.true&select=custo_micro&order=criado_em.desc&limit=200`, {
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
        });
        if (r.ok) {
          const linhas = await r.json();
          const n = Array.isArray(linhas) ? linhas.length : 0;
          const usd = (linhas || []).reduce((s, x) => s + (Number(x.custo_micro) || 0), 0) / 1e6;
          if (n >= 5) { custoAprendidoUsd = usd / n; baseAmostras = n; aprendido = true; }
        }
      }
    } catch { /* mantém o seed do piloto */ }

    const custoAnaliseBrl = custoAprendidoUsd * usdBrl;
    // Quantas análises grátis 1 Pro sustenta (env sobrepõe o cálculo, se definido).
    const analisesPorPro = Math.max(0, Math.floor(
      num(process.env.IA_ANALISES_POR_PRO, (precoPro * fracaoSubsidio) / custoAnaliseBrl)));
    const tetoSustentavel = m.n_investidor_pro * analisesPorPro;
    const usado = m.analises_explorador_mes;
    const pct = tetoSustentavel > 0 ? Math.round((usado / tetoSustentavel) * 100) : (usado > 0 ? 999 : 0);
    sustentabilidade = {
      n_investidor_pro: m.n_investidor_pro,
      n_explorador: m.n_explorador,
      analises_por_pro: analisesPorPro,
      custo_analise_usd: Math.round(custoAprendidoUsd * 1e4) / 1e4,
      custo_analise_brl: Math.round(custoAnaliseBrl * 100) / 100,
      custo_aprendido: aprendido,       // true = aprendido do fluxo real; false = semente do piloto A/B
      custo_base_amostras: baseAmostras, // nº de análises medidas que formam a média
      analises_explorador_mes: usado,
      analises_total_mes: m.analises_total_mes,
      projecao_explorador_mes: Math.round(usado * fatorProj),
      teto_sustentavel: tetoSustentavel,
      pct, status: status(pct),
      nota: `Cada Investidor Pro (R$ ${precoPro.toFixed(2)}) banca ~${analisesPorPro} análises grátis/mês (${Math.round(fracaoSubsidio * 100)}% da mensalidade ÷ R$ ${(Math.round(custoAnaliseBrl * 100) / 100).toFixed(2)}/análise ${aprendido ? `aprendido de ${baseAmostras} análises reais` : '— média do piloto A/B'}). Com ${m.n_investidor_pro} Pro(s) → teto ${tetoSustentavel} análises grátis/mês.`,
    };
  } catch { /* opcional */ }

  return new Response(JSON.stringify({
    gerado_em: new Date().toISOString(),
    usd_brl: usdBrl,
    dia_do_mes: diaDoMes, dias_no_mes: diasNoMes,
    total_mes: { custo_usd: totalMesUsd, custo_brl: brl(totalMesUsd), projecao_custo_usd: Math.round(projecaoTotalUsd * 100) / 100, projecao_custo_brl: brl(projecaoTotalUsd) },
    sustentabilidade,
    provedores,
  }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
}
