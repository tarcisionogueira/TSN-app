export const config = { runtime: 'edge' };
import { getUser, getUserRole, unauthorized, forbidden } from './_auth.js';

// Retorna status das configurações sem expor valores reais
export default async function handler(req) {

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRole(user.id);
  if (role !== 'admin') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });

  const status = {
    email:    { ok: !!process.env.RESEND_API_KEY,          label: 'Resend API Key',        grupo: 'email' },
    from:     { ok: !!process.env.APP_FROM_EMAIL,           label: 'Email remetente',        grupo: 'email' },
    baseUrl:  { ok: !!process.env.APP_BASE_URL,             label: 'URL do app',             grupo: 'geral' },
    cron:     { ok: !!process.env.CRON_SECRET,              label: 'Cron Secret',            grupo: 'geral' },
    svcKey:   { ok: !!process.env.SUPABASE_SERVICE_KEY,     label: 'Supabase Service Key',   grupo: 'banco'  },
    googleAds:{ ok: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN, label: 'Google Ads API',       grupo: 'ads'   },
    meta:     { ok: !!process.env.META_ACCESS_TOKEN,        label: 'Meta Ads API',           grupo: 'ads'   },
  };

  return new Response(JSON.stringify(status), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
