export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// Retorna status das configurações sem expor valores reais
export default async function handler(req) {

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' } });

  const status = {
    email:    { ok: !!process.env.RESEND_API_KEY,          label: 'Resend API Key',        grupo: 'email' },
    from:     { ok: !!process.env.APP_FROM_EMAIL,           label: 'Email remetente',        grupo: 'email' },
    baseUrl:  { ok: !!process.env.APP_BASE_URL,             label: 'URL do app',             grupo: 'geral' },
    cron:     { ok: !!process.env.CRON_SECRET,              label: 'Cron Secret',            grupo: 'geral' },
    svcKey:   { ok: !!process.env.SUPABASE_SERVICE_KEY,     label: 'Supabase Service Key',   grupo: 'banco'  },
    googleAds:{ ok: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN, label: 'Google Ads API',       grupo: 'ads'   },
    meta:     { ok: !!process.env.META_ACCESS_TOKEN,        label: 'Meta Ads API',           grupo: 'ads'   },
    gcalClient:  { ok: !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET), label: 'Google OAuth (client)', grupo: 'agenda' },
    gcalConectada:{ ok: !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN, label: 'Agenda Google conectada', grupo: 'agenda' },
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

  return new Response(JSON.stringify(status), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' },
  });
}
