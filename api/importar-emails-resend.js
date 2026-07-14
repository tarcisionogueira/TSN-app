export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// POST /api/importar-emails-resend  (admin/analista)
// Puxa o HISTÓRICO de e-mails enviados do Resend (endpoint List Emails, paginado)
// e grava em emails_log — dedup idempotente por resend_id. O Resend retém por
// tempo limitado, então isso captura o que ainda estiver disponível; daqui pra
// frente o registro é feito no próprio envio (api/_email.js).
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

const MAX_PAGINAS = 40;   // teto de segurança: 40 × 100 = 4.000 e-mails por chamada
const POR_PAGINA = 100;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Status do Resend → nosso rótulo simples. Qualquer evento de falha vira 'falha'.
function mapStatus(ev) {
  const e = String(ev || '').toLowerCase();
  if (['bounced', 'complained', 'failed', 'canceled'].includes(e)) return 'falha';
  return 'enviado';
}

// Categoriza e-mails antigos pelo assunto (os novos já saem com tipo do _email.js).
function inferirTipo(assunto) {
  const s = String(assunto || '').toLowerCase();
  if (s.includes('oportunidade')) return 'oportunidades';
  if (s.includes('bem-vindo') || s.includes('boas-vindas')) return 'boas_vindas';
  if (s.includes('contrato')) return 'contrato';
  if (s.includes('renova')) return 'renovacao';
  if (s.includes('financiamento')) return 'financiamento';
  if (s.includes('jurídic') || s.includes('juridic')) return 'juridico';
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();
  if (!SB || !KEY) return json({ error: 'Supabase não configurado' }, 500);
  if (!RESEND_KEY) return json({ error: 'Resend não configurado (RESEND_API_KEY ausente).' }, 500);

  let vistos = 0, importados = 0, paginas = 0, after = null;
  try {
    for (let p = 0; p < MAX_PAGINAS; p++) {
      const url = new URL('https://api.resend.com/emails');
      url.searchParams.set('limit', String(POR_PAGINA));
      if (after) url.searchParams.set('after', after);

      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${RESEND_KEY}` },
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 404) return json({ error: 'Seu plano/conta Resend ainda não expõe o endpoint de listagem de e-mails.' }, 502);
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        // Se já importamos algo, retorna o parcial em vez de falhar tudo.
        if (importados > 0) break;
        return json({ error: `Falha no Resend (${r.status})`, detalhe: txt.slice(0, 300) }, 502);
      }
      const data = await r.json().catch(() => null);
      const lista = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      if (!lista.length) break;
      paginas++;
      vistos += lista.length;

      const rows = lista.map((e) => {
        const dest = Array.isArray(e.to) ? e.to[0] : e.to;
        return {
          destinatario: String(dest || '').toLowerCase().slice(0, 200),
          assunto: (e.subject || '').slice(0, 300),
          tipo: inferirTipo(e.subject),
          status: mapStatus(e.last_event || e.status),
          resend_id: e.id || null,
          enviado_em: e.created_at || e.createdAt || null,
        };
      }).filter((row) => row.resend_id && row.destinatario);

      if (rows.length) {
        const up = await fetch(`${SB}/rest/v1/emails_log?on_conflict=resend_id`, {
          method: 'POST',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify(rows),
        });
        if (up.ok) {
          const inseridos = await up.json().catch(() => []);
          importados += Array.isArray(inseridos) ? inseridos.length : 0;
        }
      }

      after = lista[lista.length - 1]?.id || null;
      if (!data?.has_more || !after) break;
      await sleep(200); // respeita o rate limit do Resend
    }
  } catch (e) {
    if (importados === 0) return json({ error: 'Erro ao importar do Resend', detalhe: String(e?.message || e) }, 500);
  }

  return json({ ok: true, importados, ja_registrados: vistos - importados, paginas, vistos });
}
