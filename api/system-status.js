export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// Retorna status das configurações sem expor valores reais
export default async function handler(req) {

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' } });

  // Organizado por FUNÇÃO DE NEGÓCIO + IMPACTO (para gerir com eficiência):
  //   grupo   → em que parte do sistema o item atua
  //   impacto → 'critico' (sistema cai) | 'receita' (afeta faturamento) |
  //             'crescimento' (aquisição de clientes) | 'operacional' (funções do dia a dia)
  //   opcional→ pendência que NÃO trava operação (ex.: API avançada de anúncios)
  const status = {
    // ── Núcleo — sem isto, o sistema não roda ────────────────────────────────
    svcKey:   { ok: !!process.env.SUPABASE_SERVICE_KEY,    label: 'Banco de dados (Supabase)', grupo: 'nucleo', impacto: 'critico' },
    baseUrl:  { ok: !!process.env.APP_BASE_URL,            label: 'URL do app',                grupo: 'nucleo', impacto: 'critico' },
    cron:     { ok: !!process.env.CRON_SECRET,             label: 'Automações (Cron)',         grupo: 'nucleo', impacto: 'critico' },
    // ── Receita & Pagamentos ─────────────────────────────────────────────────
    asaas:    { ok: !!process.env.ASAAS_API_KEY,           label: 'Asaas (cobrança)',          grupo: 'receita', impacto: 'receita' },
    mp:       { ok: !!process.env.MP_ACCESS_TOKEN,         label: 'Mercado Pago',              grupo: 'receita', impacto: 'receita' },
    mpHook:   { ok: !!process.env.MP_WEBHOOK_SECRET,       label: 'Mercado Pago — webhook seguro', grupo: 'receita', impacto: 'receita' },
    // ── Aquisição — trazer pessoas para a plataforma ─────────────────────────
    // Rastreamento (GA4 + tag do Google Ads) já vive no index.html, não em env.
    rastreio: { ok: true,                                   label: 'Rastreamento Google (GA4 + Ads)', grupo: 'aquisicao', impacto: 'crescimento' },
    metaPixel:{ ok: !!process.env.META_PIXEL_ID,           label: 'Pixel do Meta (Facebook/Instagram)', grupo: 'aquisicao', impacto: 'crescimento' },
    googleAds:{ ok: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN, label: 'Google Ads — API (opcional)', grupo: 'aquisicao', impacto: 'crescimento', opcional: true },
    meta:     { ok: !!process.env.META_ACCESS_TOKEN,       label: 'Meta — API/Conversões (opcional)', grupo: 'aquisicao', impacto: 'crescimento', opcional: true },
    // ── Comunicação ──────────────────────────────────────────────────────────
    email:    { ok: !!process.env.RESEND_API_KEY,          label: 'E-mail (Resend)',           grupo: 'comunicacao', impacto: 'operacional' },
    from:     { ok: !!process.env.APP_FROM_EMAIL,          label: 'E-mail remetente',          grupo: 'comunicacao', impacto: 'operacional' },
    // ── Inteligência (IA) ────────────────────────────────────────────────────
    claude:   { ok: !!process.env.CLAUDE_KEY,              label: 'Claude (relatórios)',       grupo: 'ia', impacto: 'operacional' },
    gemini:   { ok: !!process.env.GEMINI_API_KEY,          label: 'Gemini (diagnóstico diário)', grupo: 'ia', impacto: 'operacional' },
    // ── Operação (conteúdo e serviços) ───────────────────────────────────────
    video:    { ok: !!process.env.DAILY_API_KEY,           label: 'Vídeo (Daily.co)',          grupo: 'operacao', impacto: 'operacional' },
    coleta:   { ok: !!process.env.BRIGHTDATA_API_TOKEN,    label: 'Coleta de lotes (Bright Data)', grupo: 'operacao', impacto: 'operacional' },
    onr:      { ok: !!(process.env.ONR_EMAIL && process.env.ONR_SENHA), label: 'Cartório (ONR / RI Digital)', grupo: 'operacao', impacto: 'operacional', opcional: true },
    // ── Agenda ───────────────────────────────────────────────────────────────
    gcalClient:  { ok: !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET), label: 'Google OAuth (client)', grupo: 'agenda', impacto: 'operacional' },
    gcalConectada:{ ok: !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN, label: 'Agenda Google conectada', grupo: 'agenda', impacto: 'operacional' },
  };

  // Consumo Bright Data da semana corrente (para o mostrador do dashboard).
  try {
    const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const teto = parseInt(process.env.BRIGHTDATA_MAX_REQ_SEMANA || '450', 10);
    if (SB && KEY) {
      const r = await fetch(`${SB}/rest/v1/brightdata_uso?select=semana,requests&order=semana.desc&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (r.ok) {
        const [row] = await r.json();
        status.brightdata = { usados: row?.requests || 0, teto, semana: row?.semana || null };
      }
    }
  } catch { /* mostrador some se falhar */ }

  // Última auditoria de segurança (o "bug bounty" contínuo) — mostrador do dashboard.
  // 0 crítico/atenção = postura íntegra; qualquer achado indica regressão a revisar.
  try {
    const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    if (SB && KEY) {
      const r = await fetch(`${SB}/rest/v1/seguranca_auditoria?select=gerado_em,total,criticos,atencao,achados&order=gerado_em.desc&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (r.ok) {
        const [row] = await r.json();
        if (row) status.seguranca = { gerado_em: row.gerado_em, total: row.total, criticos: row.criticos, atencao: row.atencao, achados: row.achados || [] };
      }
    }
  } catch { /* mostrador some se falhar */ }

  return new Response(JSON.stringify(status), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' },
  });
}
