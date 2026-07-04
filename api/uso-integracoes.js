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

  return new Response(JSON.stringify({
    gerado_em: new Date().toISOString(),
    usd_brl: usdBrl,
    total_mes: { custo_usd: totalMesUsd, custo_brl: brl(totalMesUsd) },
    provedores,
  }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
}
