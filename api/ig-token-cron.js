/**
 * GET /api/ig-token-cron — renova o token do Instagram ANTES de vencer (diário, age a cada 7 dias).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Por que existe (22/11): o IG_PAGE_TOKEN da Vercel venceu em 07/11 e nada avisou — todo direct
 * (gatilho, caixa, atendimento) seria recusado pela Meta. O token de longa duração dura ~60 dias e
 * só pode ser renovado ENQUANTO ainda vale (e com 24 h de idade), então quem renova tem que ser
 * uma rotina, não uma lembrança.
 *  - token em `ig_credencial` com mais de 7 dias → `refresh_access_token` → grava o novo;
 *  - falhou → grava `ultimo_erro` (a tela /admin/instagram mostra) e manda UM e-mail por dia
 *    enquanto faltarem ≤ 10 dias (ou já tiver vencido): aí só colar um token novo resolve.
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { credencialAtual } from './_instagram-envio.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const RENOVAR_APOS_DIAS = 7;
const AVISAR_COM_DIAS = 10;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Pura: precisa renovar? (idade ≥ 7 dias, ou validade a ≤ 20 dias) */
export function precisaRenovar(cred, agora = new Date()) {
  if (!cred?.token) return false;
  const idade = (agora - new Date(cred.renovado_em || 0)) / 86400000;
  const resta = cred.expira_em ? (new Date(cred.expira_em) - agora) / 86400000 : 0;
  return idade >= RENOVAR_APOS_DIAS || resta <= 20;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'não autorizado' });
  if (!SB || !SVC) return res.status(500).json({ error: 'Supabase não configurado' });
  try {
    const [cred] = (await sb('GET', 'ig_credencial?id=eq.1&select=token,renovado_em,expira_em,ultimo_erro')) || [];
    if (!cred) return res.status(200).json({ ok: true, motivo: 'sem_token_no_banco (cole em /admin/instagram)' });
    if (!precisaRenovar(cred)) return res.status(200).json({ ok: true, motivo: 'em_dia', expira_em: cred.expira_em });

    let erro = null;
    try {
      const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(cred.token)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.access_token) erro = `Meta ${r.status}: ${j?.error?.message || 'sem access_token na resposta'}`;
      else {
        const agora = new Date();
        await sb('PATCH', 'ig_credencial?id=eq.1', {
          token: j.access_token, renovado_em: agora.toISOString(), origem: 'renovacao', ultimo_erro: null,
          expira_em: new Date(agora.getTime() + (Number(j.expires_in) || 59 * 86400) * 1000).toISOString(),
        }, 'return=minimal');
        await credencialAtual({ fresco: true });
        return res.status(200).json({ ok: true, renovado: true });
      }
    } catch (e) { erro = `rede: ${e?.message || e}`; }

    console.error('[ig-token] renovação falhou:', erro);
    await sb('PATCH', 'ig_credencial?id=eq.1', { ultimo_erro: String(erro).slice(0, 300) }, 'return=minimal');
    const resta = cred.expira_em ? Math.floor((new Date(cred.expira_em) - Date.now()) / 86400000) : 0;
    if (resta <= AVISAR_COM_DIAS) {
      const env = await enviarEmail({
        to: process.env.ADMIN_ALERT_EMAIL || 'contato@bidprobrasil.com.br',
        subject: resta < 0 ? 'Token do Instagram VENCIDO — os gatilhos pararam' : `Token do Instagram vence em ${resta} dia(s)`,
        html: `<p>Não consegui renovar o token do Instagram automaticamente (${String(erro).replace(/[<>]/g, '')}).</p>
               <p>Enquanto ele não for trocado, nenhum direct sai: gatilhos de palavra-chave, caixa e Atendimento.</p>
               <p>Gere um token novo no painel da Meta (app BidPro - Atendimento → Instagram → Gerar token) e cole em
               <a href="https://www.bidprobrasil.com.br/#/admin/instagram">/admin/instagram</a>.</p>`,
        meta: { tipo: 'instagram_token' },
      }).catch((e) => ({ ok: false, error: e?.message }));
      if (!env?.ok) console.error('[ig-token] aviso por e-mail NÃO saiu:', env?.error || 'motivo desconhecido');
    }
    return res.status(200).json({ ok: false, erro, resta_dias: resta });
  } catch (e) {
    console.error('[ig-token]', e?.message || e);
    return res.status(500).json({ error: String(e?.message || e).slice(0, 200) });
  }
}
