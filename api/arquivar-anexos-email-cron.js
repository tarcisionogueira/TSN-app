/**
 * /api/arquivar-anexos-email-cron — ARQUIVA os anexos da caixa de e-mail no NOSSO storage.
 *
 * POR QUÊ (27/09, pedido do dono: "não podemos perder nenhum e-mail"): o corpo de todo e-mail da
 * caixa (`email_caixa.texto/html`) já fica no nosso banco, mas os ANEXOS ficavam só no Resend —
 * a linha guardava nome + id e a tela pedia o arquivo ao Resend na hora do clique. O Resend retém
 * e-mails e anexos por 30 DIAS (resend.com/docs/knowledge-base/account-quotas-and-limits): depois
 * disso a proposta de compra do leiloeiro, a matrícula enviada etc. sumiriam para sempre.
 *
 * O QUE FAZ: para cada anexo de `email_caixa` sem `arquivo`, baixa do Resend (recebido:
 * /emails/receiving/{id}/attachments/{att}; enviado: /emails/{id}/attachments) e grava no bucket
 * privado `documentos` em `email/<email_caixa.id>/<idx>_<nome>` — que o backup off-region (R2) já
 * copia sozinho (backup_manifesto_irrecuperaveis). Marca `arquivo` + `arquivado_em` no próprio anexo.
 * Idempotente; o que falha fica sem `arquivo` e é tentado de novo na próxima hora (dentro dos 30
 * dias). A tela (`api/email-caixa.js`) abre a cópia NOSSA primeiro e só cai no Resend sem ela.
 * O invariante `anexo_email_nao_arquivado` grita se algo passar de 3 dias sem arquivo.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const LOTE = 25;                 // mensagens por rodada (hora a hora; o volume é pequeno)
const ORCAMENTO_MS = 100_000;    // sobra tempo para responder antes do maxDuration

const sbH = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Mesma allowlist do inbound-juridico.js: a URL vem da API do Resend, mas quem baixa é o nosso
// servidor — resposta adulterada não pode virar SSRF.
function hostPermitido(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'resend.com' || u.hostname.endsWith('.resend.com')
      || u.hostname.endsWith('.amazonaws.com') || u.hostname.endsWith('.cloudflarestorage.com'));
  } catch { return false; }
}

async function resendJson(path) {
  const r = await fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${RESEND_KEY}` }, signal: AbortSignal.timeout(10000) });
  const j = r.ok ? await r.json().catch(() => null) : null;
  return { status: r.status, j };
}

// Devolve { bytes, contentType } ou lança com o motivo (nunca "vazio" calado).
async function baixar(msg, anexo, idx, cacheEnviados) {
  let url = null, tipo = anexo?.content_type || null;
  if (msg.direcao === 'entrada') {
    if (!anexo?.id) throw new Error('anexo recebido sem id do Resend');
    const { status, j } = await resendJson(`/emails/receiving/${encodeURIComponent(msg.resend_email_id)}/attachments/${encodeURIComponent(anexo.id)}`);
    if (!j?.download_url) throw new Error(`Resend recebido HTTP ${status}${j ? ` keys=${Object.keys(j).join(',')}` : ''}`);
    url = j.download_url; tipo = tipo || j.content_type || null;
  } else {
    // Enviado: o que o Resend de fato anexou (mesma fonte que a tela já usava).
    if (!cacheEnviados.has(msg.id)) {
      const { status, j } = await resendJson(`/emails/${encodeURIComponent(msg.resend_email_id)}/attachments`);
      const itens = Array.isArray(j?.data) ? j.data : (Array.isArray(j) ? j : null);
      if (!itens) throw new Error(`Resend enviados HTTP ${status}`);
      cacheEnviados.set(msg.id, itens);
    }
    const itens = cacheEnviados.get(msg.id);
    const alvo = itens.find(a => a?.filename === anexo?.nome) || itens[idx];
    if (!alvo) throw new Error('anexo enviado não listado pelo Resend');
    url = alvo.download_url || null;
    if (!url && alvo.id) {
      const { status, j } = await resendJson(`/emails/${encodeURIComponent(msg.resend_email_id)}/attachments/${encodeURIComponent(alvo.id)}`);
      url = j?.download_url || null;
      if (!url) throw new Error(`Resend anexo enviado HTTP ${status}`);
    }
    tipo = tipo || alvo.content_type || null;
  }
  if (!url || !hostPermitido(url)) throw new Error('download_url ausente ou com host fora da allowlist');
  const bin = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!bin.ok) throw new Error(`download HTTP ${bin.status}`);
  return { bytes: new Uint8Array(await bin.arrayBuffer()), contentType: tipo || bin.headers.get('content-type') || 'application/octet-stream' };
}

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase ausente' }, 500);
  if (!RESEND_KEY) return json({ error: 'RESEND_API_KEY ausente — nada arquivado' }, 500);

  const T0 = Date.now();
  // Linhas com resend_email_id e ALGUM anexo sem `arquivo`, dentro da janela de retenção do Resend.
  const desde = new Date(Date.now() - 30 * 864e5).toISOString();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/email_caixa_anexos_pendentes`, {
    method: 'POST', headers: { ...sbH(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_desde: desde, p_limite: LOTE }),
  });
  if (!r.ok) return json({ error: `pendentes: HTTP ${r.status} ${(await r.text()).slice(0, 200)}` }, 500);
  const pendentes = await r.json();

  const out = { mensagens: pendentes.length, arquivados: 0, falhas: [], cortado: false };
  const cacheEnviados = new Map();
  for (const msg of pendentes) {
    if (Date.now() - T0 > ORCAMENTO_MS) { out.cortado = true; break; }
    const anexos = Array.isArray(msg.anexos) ? msg.anexos.map(a => ({ ...a })) : [];
    let mudou = false;
    for (let idx = 0; idx < anexos.length; idx++) {
      const a = anexos[idx];
      if (a?.arquivo) continue;
      try {
        const { bytes, contentType } = await baixar(msg, a, idx, cacheEnviados);
        const nome = String(a?.nome || 'anexo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(0, 120);
        const path = `email/${msg.id}/${idx}_${nome}`;
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${path}`, {
          method: 'POST', headers: { ...sbH(), 'Content-Type': contentType, 'x-upsert': 'true' }, body: bytes,
        });
        if (!up.ok) throw new Error(`storage HTTP ${up.status} ${(await up.text()).slice(0, 120)}`);
        anexos[idx] = { ...a, arquivo: path, arquivado_em: new Date().toISOString(), tamanho: a?.tamanho ?? bytes.length, content_type: a?.content_type || contentType };
        mudou = true; out.arquivados++;
      } catch (e) {
        out.falhas.push({ email_caixa: msg.id, anexo: a?.nome || idx, motivo: String(e?.message || e).slice(0, 160) });
        console.error('[arquivar-anexos] falha', msg.id, a?.nome, String(e?.message || e).slice(0, 160));
      }
    }
    if (mudou) {
      // `.select` via return=representation: só a linha devolvida prova que o PATCH alcançou.
      const p = await fetch(`${SUPABASE_URL}/rest/v1/email_caixa?id=eq.${msg.id}`, {
        method: 'PATCH', headers: { ...sbH(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ anexos }),
      });
      const linhas = p.ok ? await p.json().catch(() => []) : [];
      if (!p.ok || !linhas.length) out.falhas.push({ email_caixa: msg.id, motivo: `PATCH não alcançou a linha (HTTP ${p.status}) — arquivo gravado, marca pendente` });
    }
  }
  return json({ ok: out.falhas.length === 0, ...out });
}
