/**
 * Cron diário do jurídico (casos com juridico_status='em_revisao'):
 *  1) LEMBRETES: até 3 e-mails nos dias úteis 2, 4 e 6 após o envio, para os
 *     destinatários do advogado do caso. Param automaticamente quando a
 *     devolutiva chega (inbound-juridico move o caso para 'publicado').
 *  2) REATRIBUIÇÃO POR PRAZO: passados 7 dias úteis sem devolutiva, a pasta é
 *     repassada EM CARÁTER DE URGÊNCIA ao advogado de MELHOR EFICIÊNCIA
 *     (view advogado_eficiencia) que tenha e-mail configurado e seja diferente
 *     do atual — com novo prazo e novo token de resposta.
 *
 * Stateless: o estado vive nos casos (juridico_lembretes / prazo_juridico /
 * juridico_reatribuicoes). Idempotente por dia (não reenvia o mesmo lembrete).
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { addDiasUteis, diasUteisEntre } from './_dias-uteis.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const INBOUND_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || 'bidprobrasil.com.br';
const APP_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const DIAS_LEMBRETE = [2, 4, 6]; // dias úteis em que cai cada lembrete
const PRAZO_DIAS = 7;            // dias úteis para devolutiva

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = e => String(e || '').trim().toLowerCase();
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: hdr });
  return r.ok ? r.json() : [];
}
async function sbPatch(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: { ...hdr, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
}
async function sbPost(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'POST', headers: { ...hdr, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
}
async function emailDoUsuario(id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: hdr });
    const d = await r.json();
    return d?.email || null;
  } catch { return null; }
}

// Destinatários (To/CC) do advogado — mesma regra do enviar-juridico-email.
async function destinatarios(advogadoId) {
  const filtroAdv = advogadoId ? `&or=(advogado_id.is.null,advogado_id.eq.${advogadoId})` : `&advogado_id=is.null`;
  const dests = await sbGet(`juridico_destinatarios?ativo=eq.true${filtroAdv}&select=nome,email,copia`);
  let to = (dests || []).filter(d => d.copia === false && d.email).map(d => norm(d.email));
  let cc = (dests || []).filter(d => d.copia === true && d.email).map(d => norm(d.email));
  if (!to.length && advogadoId) { const e = await emailDoUsuario(advogadoId); if (e) to = [norm(e)]; }
  cc = [...new Set(cc)].filter(e => e && !to.includes(e));
  const nome = (dests || []).find(d => d.copia === false)?.nome || null;
  return { to, cc, nome };
}

// Melhor advogado por eficiência, com e-mail e diferente do atual.
async function melhorAdvogado(excluirId) {
  const rank = await sbGet(`advogado_eficiencia?select=advogado_id,nome,score,taxa_resposta_pct&order=score.desc.nullslast`);
  for (const r of (Array.isArray(rank) ? rank : [])) {
    if (!r.advogado_id || r.advogado_id === excluirId) continue;
    const dest = await destinatarios(r.advogado_id);
    if (dest.to.length) return { advogado_id: r.advogado_id, nome: r.nome || dest.nome, dest, score: r.score };
  }
  // Fallback: qualquer advogado cadastrado com e-mail (sem histórico ainda).
  const advs = await sbGet(`perfis?role=eq.advogado&select=id,nome`);
  for (const a of (Array.isArray(advs) ? advs : [])) {
    if (!a.id || a.id === excluirId) continue;
    const dest = await destinatarios(a.id);
    if (dest.to.length) return { advogado_id: a.id, nome: a.nome || dest.nome, dest, score: null };
  }
  return null;
}

async function anexosDoImovel(imovelId) {
  if (!imovelId) return [];
  const a = await sbGet(`imovel_anexos?imovel_id=eq.${encodeURIComponent(imovelId)}&select=nome,url,tipo`);
  return (Array.isArray(a) ? a : []).filter(x => x.url);
}

async function chatInterno(caso, conteudo) {
  let [ch] = await sbGet(`chamados?caso_id=eq.${encodeURIComponent(caso.id)}&segmento=eq.interno&select=id&limit=1`);
  if (!ch?.id) return;
  await sbPost('chamados_mensagens', { chamado_id: ch.id, autor_tipo: 'sistema', autor_nome: 'Sistema', conteudo, anexos: [] });
}

function htmlBase(titulo, corpo, refCurto) {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 10px">${esc(titulo)}</h2>
    ${corpo}
    <p style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 14px;margin:16px 0;font-size:14px">
      👉 <strong>Basta responder a este próprio e-mail</strong> com seu parecer. A resposta é registrada automaticamente no caso.</p>
    <p style="color:#64748b;font-size:12px;margin-top:18px">BidPro Brasil · Jurídico · Ref. ${esc(refCurto)}</p>
  </div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const agora = new Date();
  const hojeStr = agora.toISOString().slice(0, 10);
  const casos = await sbGet(`casos?juridico_status=eq.em_revisao&juridico_enviado_em=not.is.null&select=id,imovel_id,imovel_endereco,tipo_leilao,advogado_id,juridico_enviado_em,prazo_juridico,juridico_token,juridico_lembretes,juridico_ultimo_lembrete,juridico_reatribuicoes`);
  const resumo = { casos: Array.isArray(casos) ? casos.length : 0, lembretes: 0, reatribuicoes: 0, sem_destino: 0, erros: 0 };

  for (const caso of (Array.isArray(casos) ? casos : [])) {
    try {
      const refCurto = String(caso.id).split('-')[0].toUpperCase();
      const prazo = caso.prazo_juridico ? new Date(caso.prazo_juridico) : addDiasUteis(caso.juridico_enviado_em, PRAZO_DIAS);
      const diasUteis = diasUteisEntre(caso.juridico_enviado_em, agora);
      const venceu = agora > prazo;

      // ── 1) PRAZO PERDIDO → reatribui ao advogado de melhor eficiência ──
      if (venceu) {
        const novo = await melhorAdvogado(caso.advogado_id);
        if (!novo) { resumo.sem_destino++; continue; } // ninguém para repassar
        const token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.round(Math.random() * 1e6)}`).replace(/-/g, '').slice(0, 16);
        const novoPrazo = addDiasUteis(agora, PRAZO_DIAS);
        await sbPatch(`casos?id=eq.${caso.id}`, {
          advogado_id: novo.advogado_id, juridico_advogado_anterior: caso.advogado_id,
          juridico_reatribuicoes: (caso.juridico_reatribuicoes || 0) + 1,
          juridico_enviado_em: agora.toISOString(), prazo_juridico: novoPrazo.toISOString(),
          juridico_lembretes: 0, juridico_ultimo_lembrete: null, juridico_token: token,
        });
        const anexos = await anexosDoImovel(caso.imovel_id);
        const listaAnexos = anexos.length
          ? `<ul style="margin:6px 0 0;padding-left:18px">${anexos.map(a => `<li>${esc(a.nome)} <span style="color:#94a3b8">(${esc(a.tipo)})</span></li>`).join('')}</ul>`
          : '<p style="color:#b45309">⚠️ Sem documentos anexados ao imóvel.</p>';
        const corpo = `
          <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;color:#991b1b;font-weight:700">⚠️ URGENTE — pasta repassada por perda de prazo do parecer anterior.</p>
          <p>Prezado(a) ${esc(novo.dest.nome || novo.nome || 'Doutor(a)')}, solicitamos análise <strong>com urgência</strong> da documentação para confirmação de viabilidade.</p>
          <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
            <tr><td style="padding:3px 10px 3px 0;color:#64748b">Imóvel</td><td><strong>${esc(caso.imovel_endereco || caso.imovel_id)}</strong></td></tr>
            <tr><td style="padding:3px 10px 3px 0;color:#64748b">Tipo de leilão</td><td>${esc(caso.tipo_leilao || '—')}</td></tr>
            <tr><td style="padding:3px 10px 3px 0;color:#64748b">Novo prazo</td><td>${novoPrazo.toLocaleDateString('pt-BR')} (7 dias úteis)</td></tr>
          </table>
          <p style="font-weight:700;margin:14px 0 4px">Documentos do imóvel:</p>${listaAnexos}`;
        const r = await enviarEmail({
          from: 'BidPro Brasil Jurídico <noreply@bidprobrasil.com.br>',
          to: novo.dest.to, cc: novo.dest.cc,
          replyTo: `juridico+${token}@${INBOUND_DOMAIN}`,
          subject: `🔴 URGENTE — Análise jurídica reatribuída — Caso ${refCurto}`,
          html: htmlBase('Análise jurídica — URGENTE (reatribuição)', corpo, refCurto),
          attachments: anexos.map(a => ({ filename: a.nome || 'documento', path: a.url })),
        });
        if (r.ok) {
          resumo.reatribuicoes++;
          await sbPost('juridico_emails', { caso_id: caso.id, direcao: 'saida', message_id: r.id, de: 'noreply@bidprobrasil.com.br', para: [...novo.dest.to, ...novo.dest.cc.map(c => `cc:${c}`)].join(', '), assunto: `URGENTE reatribuição — Caso ${refCurto}` });
          await chatInterno(caso, `🔴 Prazo do jurídico vencido. Pasta reatribuída por URGÊNCIA ao advogado de melhor eficiência (${esc(novo.nome || '—')}${novo.score != null ? ` · score ${novo.score}` : ''}). Novo prazo: ${novoPrazo.toLocaleDateString('pt-BR')}.`);
        } else { resumo.erros++; }
        continue;
      }

      // ── 2) LEMBRETES (dias úteis 2/4/6) ──
      const esperados = DIAS_LEMBRETE.filter(x => diasUteis >= x).length;
      const jaHoje = caso.juridico_ultimo_lembrete && String(caso.juridico_ultimo_lembrete).slice(0, 10) === hojeStr;
      if (esperados > (caso.juridico_lembretes || 0) && !jaHoje) {
        const dest = await destinatarios(caso.advogado_id);
        if (!dest.to.length) { resumo.sem_destino++; continue; }
        const token = caso.juridico_token || '';
        const restante = Math.max(0, diasUteisEntre(agora, prazo));
        const corpo = `
          <p>Prezado(a) ${esc(dest.nome || 'Doutor(a)')}, este é um <strong>lembrete (${esperados}/3)</strong> sobre a análise jurídica pendente:</p>
          <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
            <tr><td style="padding:3px 10px 3px 0;color:#64748b">Imóvel</td><td><strong>${esc(caso.imovel_endereco || caso.imovel_id)}</strong></td></tr>
            <tr><td style="padding:3px 10px 3px 0;color:#64748b">Prazo</td><td>${prazo.toLocaleDateString('pt-BR')} — restam ~${restante} dia(s) útil(eis)</td></tr>
          </table>
          <p>Agradecemos a devolutiva dentro do prazo. Se já respondeu, favor desconsiderar.</p>`;
        const r = await enviarEmail({
          from: 'BidPro Brasil Jurídico <noreply@bidprobrasil.com.br>',
          to: dest.to, cc: dest.cc,
          replyTo: token ? `juridico+${token}@${INBOUND_DOMAIN}` : undefined,
          subject: `Lembrete (${esperados}/3) — Análise jurídica — Caso ${refCurto}`,
          html: htmlBase('Lembrete de análise jurídica', corpo, refCurto),
        });
        if (r.ok) {
          resumo.lembretes++;
          await sbPatch(`casos?id=eq.${caso.id}`, { juridico_lembretes: esperados, juridico_ultimo_lembrete: agora.toISOString() });
        } else { resumo.erros++; }
      }
    } catch (e) {
      resumo.erros++;
    }
  }

  return res.status(200).json(resumo);
}
