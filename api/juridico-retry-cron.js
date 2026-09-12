/**
 * /api/juridico-retry-cron — ESCALADA de retentativa da consulta jurídica (CNJ/DataJud,
 * DJEN/Comunica CNJ) quando a fonte pública está indisponível no momento da geração.
 *
 * Pedido do dono (12/09): esse vício (`cnj_nao_consultado`, gravado por
 * api/gerar-documental.js em `analises_documental.regen_motivo`) é FONTE PÚBLICA instável,
 * não dado ausente — medido no mesmo dia: nosso DataJud teve sucesso em 11/09, DJEN em
 * 04/09; não é uma queda contínua, é intermitência. Por isso fica de fora do cron genérico
 * (regenerar-relatorios-cron.js, 6h fixas / 3 tentativas / 72h) e ganha escala própria:
 *
 *   30min → 1h → 2h → 4h → 6h → mantém a cada 6h dali em diante (sem teto de tentativas:
 *   "até conseguir", porque o defeito é do lado de fora, não nosso).
 *
 * SÓ PARA O CASO "PURO" (`regen_motivo` = exatamente `cnj_nao_consultado`, sem outro vício
 * junto). Achado em produção no dia da implementação: 2 linhas com
 * `matricula_nao_lida,edital_nao_lido,cnj_nao_consultado` juntos, paradas há 43 e 8 dias — aí
 * o documental tem pendência PRÓPRIA (não é só a fonte pública travando), e "até conseguir"
 * sem teto viraria retentativa eterna sobre um caso que pode nunca ter o outro dado. Esses
 * ficam no cron genérico (com teto), que é o correto para eles.
 *
 * AVISO POR E-MAIL: só a partir de quando a escalada ALCANÇA o degrau de 2h (3ª tentativa)
 * — antes disso é considerado "instabilidade rápida, resolve sozinha" e não vale
 * incomodar o cliente. Dali em diante a linha fica marcada (`juridico_avisar_email`) e,
 * assim que o vício sumir (a fonte respondeu), sai um e-mail avisando que o relatório foi
 * atualizado.
 *
 * Fire-and-forget, como regenerar-relatorios-cron.js: cada regeração é uma invocação
 * independente de /api/gerar-documental; este cron só decide QUANDO tentar de novo e
 * quando notificar — nunca lê o resultado da regeneração na mesma passada (ele aparece
 * pronto, ou pendente de novo, na PRÓXIMA passada do cron).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = (process.env.CRON_SECRET || '').trim();
const APP_URL = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace('://bidprobrasil.com.br', '://www.bidprobrasil.com.br');

// Índice = juridico_tentativas já feitas; valor = minutos até a PRÓXIMA. Da 5ª em diante,
// repete o último degrau (6h) — é o "mantém a cada seis horas" do pedido.
const DELAYS_MIN = [30, 60, 120, 240, 360];
const DEGRAU_AVISO = 2; // índice 0-based: ao completar a tentativa de índice 2 (a que ESPEROU 2h), liga o aviso.
const delayFor = (tentativas) => DELAYS_MIN[Math.min(tentativas, DELAYS_MIN.length - 1)];

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: hdr });
  return r.ok ? r.json() : [];
}
async function sbPatch(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: { ...hdr, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
}
async function emailDoUsuario(id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: hdr });
    if (!r.ok) { console.error('[juridico-retry-cron] emailDoUsuario HTTP', r.status); return null; }
    const d = await r.json();
    return d?.email || null;
  } catch (e) { console.error('[juridico-retry-cron] emailDoUsuario erro', e?.message || e); return null; }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) return res.status(500).json({ error: 'env ausente' });

  const resumo = { tentadas: 0, avisadas: 0, erros: 0 };

  // ── 1) QUEM AINDA ESTÁ PENDENTE — dispara nova tentativa se já venceu o prazo do degrau atual.
  try {
    const pendentes = await sbGet(
      `analises_documental?status=eq.concluida&regen_motivo=eq.cnj_nao_consultado` +
      `&select=user_id,imovel_id,titulo,cidade,estado,regen_em,updated_at,juridico_tentativas&order=updated_at.asc&limit=30`
    );
    for (const r of (Array.isArray(pendentes) ? pendentes : [])) {
      try {
        const tentativas = r.juridico_tentativas || 0;
        const ancora = r.regen_em || r.updated_at;
        const devidoEm = new Date(ancora).getTime() + delayFor(tentativas) * 60_000;
        if (Date.now() < devidoEm) continue; // ainda dentro do degrau atual — não é a vez desta linha

        const novasTentativas = tentativas + 1;
        const ligarAviso = novasTentativas > DEGRAU_AVISO; // completou o degrau de 2h (índice 2)
        await sbPatch(
          `analises_documental?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`,
          { juridico_tentativas: novasTentativas, juridico_avisar_email: ligarAviso || undefined }
        );
        await fetch(`${APP_URL}/api/gerar-documental`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
          body: JSON.stringify({ imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado }),
          signal: AbortSignal.timeout(9000),
        }).catch(() => {});
        resumo.tentadas++;
      } catch { resumo.erros++; }
    }
  } catch { resumo.erros++; }

  // ── 2) QUEM JÁ ESTAVA MARCADO PARA AVISAR E RESOLVEU — manda o e-mail e limpa a marca.
  // `or=` cobre tanto regen_motivo NULO (todos os vícios sumiram) quanto preenchido sem cnj.
  try {
    const resolvidos = await sbGet(
      `analises_documental?juridico_avisar_email=eq.true` +
      `&or=(regen_motivo.is.null,regen_motivo.not.ilike.*cnj_nao_consultado*)` +
      `&select=user_id,imovel_id,titulo,cidade,estado&limit=30`
    );
    for (const r of (Array.isArray(resolvidos) ? resolvidos : [])) {
      try {
        const destino = await emailDoUsuario(r.user_id);
        const endereco = r.titulo || [r.cidade, r.estado].filter(Boolean).join('/') || 'seu imóvel';
        const link = `${APP_URL}/#/analise?imovel=${encodeURIComponent(r.imovel_id)}`;
        let enviado = true;
        if (destino) {
          const resp = await enviarEmail({
            to: destino,
            subject: `Consulta jurídica concluída — ${endereco}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
              <p>A consulta ao processo judicial (CNJ/DataJud e DJEN) que estava aguardando resposta da fonte pública foi concluída.</p>
              <p><strong>${esc(endereco)}</strong></p>
              <p>Seu relatório de <strong>Análise Documental e Jurídica</strong> já está atualizado com o resultado.</p>
              <p style="margin-top:18px"><a href="${esc(link)}" style="background:#1e3a8a;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Ver o relatório</a></p>
              <p style="color:#94a3b8;font-size:11px;margin-top:24px">BidPro Brasil</p>
            </div>`,
            meta: { tipo: 'juridica_preliminar', userId: r.user_id },
          });
          enviado = !!resp.ok;
        }
        await sbPatch(
          `analises_documental?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`,
          { juridico_tentativas: 0, juridico_avisar_email: false }
        );
        if (enviado) resumo.avisadas++; else resumo.erros++;
      } catch { resumo.erros++; }
    }
  } catch { resumo.erros++; }

  return res.status(200).json(resumo);
}
